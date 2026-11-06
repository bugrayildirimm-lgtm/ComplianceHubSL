import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, json, shortText } from '../../shared/compliance.ts';
import { reserveUsage } from '../../shared/usageBudget.ts';
import { FETCH_MAINTENANCE } from '../../shared/protectedFetch.ts';
import {
  TARGET_TOPICS, SOURCE_TYPES, testCandidateSource, publisherEvidence, creditNote,
} from '../../shared/discovery.ts';

// One resumable batch of official-source discovery. A batch claims a small
// number of queue items, researches each jurisdiction, retrieves every
// candidate URL itself, and leaves candidates pending human verification.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);
    // Discovery retrieves candidate URLs. Paused while no connection-pinned
    // protected-fetch transport exists; queue positions are untouched.
    if (FETCH_MAINTENANCE.paused) return json({ ...FETCH_MAINTENANCE }, 503);
    const body = await req.json().catch(() => ({}));
    const configs = await base44.asServiceRole.entities.MonitoringConfig.filter({ config_key: 'default' });
    let config = configs[0] || null;
    if (!config) {
      config = await base44.asServiceRole.entities.MonitoringConfig.create({
        config_key: 'default', monitoring_enabled: true, daily_check_hour_utc: 6, priority_interval_hours: 6,
        max_sources_per_run: 8, discovery_batch_size: 4, max_discovery_attempts: 3, requirement_batch_size: 4,
        monthly_credit_budget: 1500, credits_used_estimate: 0, usage_alert_threshold_pct: 80, budget_paused: false,
      });
    }

    const triggerType = body.trigger_type === 'Workflow' ? 'Workflow' : 'Manual';
    const runRef = await nextRef(base44, 'DiscoveryRun', 'run_ref', 'DRUN', 5);
    const startedAt = new Date().toISOString();

    if (config.budget_paused === true) {
      await base44.asServiceRole.entities.DiscoveryRun.create({
        run_ref: runRef, run_kind: 'Source discovery', trigger_type: triggerType,
        status: 'Blocked — budget or usage limit', processed: 0, candidates_created: 0,
        llm_calls: 0, credits_estimated: 0, started_at: startedAt, finished_at: startedAt,
        notes: `Discovery did not run: ${config.budget_paused_reason || 'budget paused'}. This is a coverage limitation, not a completed check.`,
      });
      return json({ run_ref: runRef, blocked: true, reason: config.budget_paused_reason || 'Budget paused — discovery did not run.' });
    }

    const limit = Math.min(Number(body.limit) || Number(config.discovery_batch_size) || 4, 6);
    const maxAttempts = Number(config.max_discovery_attempts) || 3;

    await base44.asServiceRole.entities.DiscoveryQueue.updateMany({ status: 'Researching', last_run_at: { $lt: new Date(Date.now() - 10*60000).toISOString() } }, { $set: { status: 'Queued', block_reason: 'Expired discovery worker claim; safely requeued.' } });
    const queuePage = await base44.asServiceRole.entities.DiscoveryQueue.list({ limit: 500 });
    const queue = queuePage.items || queuePage || [];
    let candidatesForWork = queue
      // Untouched jurisdictions and failed retrievals go first. A market that
      // already has candidates is not re-researched for a week, so a batch
      // always advances through the register instead of looping on the same few.
      .filter((q) => ['Queued', 'Blocked — retrieval failed'].includes(q.status)
        || (['Candidates proposed', 'Coverage partial'].includes(q.status)
          && (!q.last_run_at || Date.now() - Date.parse(q.last_run_at) > 7 * 86400000)))
      .filter((q) => (q.attempts || 0) < maxAttempts)
      .sort((a, b) => (a.attempts || 0) - (b.attempts || 0) || (a.priority_rank || 9) - (b.priority_rank || 9) || String(a.jurisdiction_id).localeCompare(String(b.jurisdiction_id)))
      .slice(0, limit);

    if (!candidatesForWork.length) {
      const remaining = queue.filter((q) => /Blocked|Queued/.test(q.status));
      return json({
        run_ref: runRef, processed: 0, candidates_created: 0,
        message: 'No jurisdiction is ready for discovery. Every queued item is either resolved, exhausted its attempts, or blocked for a person to resolve.',
        outstanding: remaining.map((q) => ({ jurisdiction: q.jurisdiction_name, status: q.status })),
      });
    }

    // Claim the items first so a parallel or overlapping batch cannot duplicate work.
    const claimed = [];
    for (const q of candidatesForWork) {
      const result = await base44.asServiceRole.entities.DiscoveryQueue.updateMany({ id: q.id, updated_date: q.updated_date }, { $set: { status: 'Researching', last_run_id: runRef, last_run_at: startedAt, attempts: (q.attempts || 0) + 1 } });
      if (result.updated === 1) claimed.push(q);
    }
    candidatesForWork = claimed;

    const jurisdictions = (await base44.asServiceRole.entities.Jurisdiction.list({ limit: 500 }));
    const jurisdictionItems = jurisdictions.items || jurisdictions || [];
    const jByCode = new Map(jurisdictionItems.map((j) => [j.jurisdiction_id, j]));

    const allSources = (await base44.asServiceRole.entities.Source.list({ limit: 500 }));
    const sourceItems = allSources.items || allSources || [];
    const knownUrls = new Set(sourceItems.map((s) => String(s.url || '').replace(/\/$/, '')));

    const failures = [];
    const results = [];
    let candidatesCreated = 0;
    let testedOk = 0;
    let llmCalls = 0;

    for (const item of candidatesForWork) {
      const jurisdiction = jByCode.get(item.jurisdiction_id);
      const label = jurisdiction?.name || item.jurisdiction_name;
      try {
        let analysis = null;
        try {
          const reservation = await reserveUsage(base44);
          if (!reservation.ok) {
            await base44.asServiceRole.entities.DiscoveryQueue.update(item.id, { status: 'Queued', block_reason: reservation.reason });
            continue;
          }
          llmCalls += 1;
          analysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: [
              'You are helping a gambling supplier (slots, live casino games, live casino studios) find the ORIGINAL official publications it must monitor. Search results are not evidence — only pages published by the authority itself count.',
              `Jurisdiction: ${label}${jurisdiction?.territory_scope ? ` (territorial scope as recorded: ${jurisdiction.territory_scope})` : ''}. Internal classification: ${item.internal_classification}.`,
              'Propose up to 5 sources, each a specific publication, listing, register or instrument page — never just a homepage when a deeper page exists.',
              'Cover different subject areas where they exist: market entry/licensing, slots technical standards, live casino technical standards, live studio/premises rules, enforcement/sanctions, legislation/gazette, consultations or bills.',
              'Use the official local-language version where that is the authoritative text, and say which language it is in. Add the English version as a separate source only if it genuinely exists.',
              'Only governmental, regulator, official gazette, legislation database, parliament or court publishers. Never law firms, media, consultancies or commercial compliance feeds.',
              'Give the exact URL as published. If you are not certain a URL exists, omit it instead of guessing.',
              'State which of the requested subject areas you could NOT evidence, in coverage_gaps. Never claim coverage you did not find.',
              'Return JSON only.',
            ].join('\n'),
            add_context_from_internet: true,
            response_json_schema: {
              type: 'object',
              properties: {
                sources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      authority: { type: 'string' },
                      url: { type: 'string' },
                      source_type: { type: 'string', enum: SOURCE_TYPES },
                      language: { type: 'string' },
                      topics: { type: 'array', items: { type: 'string', enum: TARGET_TOPICS } },
                      territorial_scope: { type: 'string' },
                      publisher_note: { type: 'string', description: 'Why the named authority is the publisher' },
                    },
                    required: ['authority', 'url', 'source_type', 'publisher_note'],
                  },
                },
                topics_covered: { type: 'array', items: { type: 'string' } },
                coverage_gaps: { type: 'string' },
              },
              required: ['sources'],
            },
          });
        } catch (llmError) {
          failures.push({ jurisdiction: label, error: `Research unavailable: ${shortText(String(llmError?.message || llmError), 200)}` });
          await base44.asServiceRole.entities.DiscoveryQueue.update(item.id, {
            status: 'Blocked — retrieval failed',
            block_reason: 'The AI research call failed for this jurisdiction; no source was proposed and no coverage is claimed.',
          });
          continue;
        }

        const proposals = (Array.isArray(analysis?.sources) ? analysis.sources : [])
          .filter((p) => p?.url && /^https?:\/\//i.test(p.url))
          .slice(0, 5);

        const created = [];
        const rejected = [];
        for (const proposal of proposals) {
          const key = proposal.url.replace(/\/$/, '');
          if (knownUrls.has(key)) continue;
          const probe = await testCandidateSource(proposal.url);
          if (!probe.ok || probe.blocked) {
            rejected.push(`${proposal.url} — HTTP ${probe.status || 'error'}${probe.blocked ? ', access blocked' : ''}${probe.error ? `, ${probe.error}` : ''}`);
            await base44.asServiceRole.entities.DiscoveryAttempt.create({
              run_ref: runRef, jurisdiction_id: item.jurisdiction_id, jurisdiction_name: label,
              origin: 'AI research proposal', url: proposal.url,
              outcome: probe.blocked ? 'Access blocked' : 'Retrieval failed',
              outcome_class: probe.blocked ? 'Source found but retrieval blocked' : 'Source not yet found',
              http_status: Number(probe.status) || 0,
              detail: shortText(`${proposal.authority || ''} ${probe.error || ''}`.trim(), 400),
              attempted_at: new Date().toISOString(), attempted_by: actor.email,
            });
            continue;
          }
          knownUrls.add(key);
          testedOk += 1;
          const sourceType = SOURCE_TYPES.includes(proposal.source_type) ? proposal.source_type : 'Other official';
          const topics = (Array.isArray(proposal.topics) ? proposal.topics : []).filter((t) => TARGET_TOPICS.includes(t));
          const record = await base44.asServiceRole.entities.Source.create({
            source_id: await nextRef(base44, 'Source', 'source_id', 'SRC', 5),
            jurisdiction_id: item.jurisdiction_id,
            jurisdiction_name: label,
            authority: shortText(proposal.authority, 200),
            url: proposal.url,
            source_type: sourceType,
            language: proposal.language || 'Unknown',
            topics,
            subject_coverage: topics,
            territorial_scope: shortText(proposal.territorial_scope || jurisdiction?.territory_scope || label, 240),
            coverage_gaps: shortText(analysis?.coverage_gaps || '', 500),
            retrieval_http_status: probe.status,
            retrieval_result: `HTTP ${probe.status} · ${probe.is_pdf ? 'PDF' : 'HTML'} · ${probe.bytes} bytes · retrieved ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
            retrieval_tested_at: new Date().toISOString(),
            retrieval_page_title: shortText(probe.title, 240),
            publisher_evidence: publisherEvidence(proposal.url, probe, proposal.authority),
            collection_method: probe.is_pdf ? 'Not configured' : 'Direct page retrieval',
            check_frequency: 'Daily',
            priority: false,
            verification_status: 'Awaiting source verification',
            verification_evidence: `${proposal.publisher_note || ''} Retrieved and tested by the collector on ${new Date().toISOString().slice(0, 10)}. A person must still confirm the publishing authority.`,
            discovered_by: 'AI-assisted discovery (batch queue)',
            discovery_run_id: runRef,
            health_status: 'Awaiting source verification',
            fetch_status: probe.ok ? 'Retrieved during discovery' : 'Failed',
            extraction_status: probe.is_pdf ? 'Pending — PDF text extraction not configured' : 'Retrieved text available',
            analysis_status: 'Not analysed (candidate)',
            notification_status: 'Not applicable',
            consecutive_failures: 0,
            alert_count: 0,
          });
          created.push({ source_id: record.source_id, authority: record.authority, url: record.url, http: probe.status, title: shortText(probe.title, 120), topics });
          candidatesCreated += 1;
        }

        const coveredTopics = Array.from(new Set(created.flatMap((c) => c.topics)));
        const gapText = [
          analysis?.coverage_gaps || '',
          rejected.length ? `Candidates that could not be retrieved and were NOT accepted: ${rejected.join(' | ')}` : '',
          proposals.length === 0 ? 'No official source was proposed for this jurisdiction; nothing is claimed as covered.' : '',
        ].filter(Boolean).join(' ');

        await base44.asServiceRole.entities.DiscoveryQueue.update(item.id, {
          // Zero results with a failed retrieval is a scoped retrieval gap. Zero
          // results with nothing rejected means no source has been located yet —
          // that stays queued, it is never recorded as "no regulation exists".
          status: created.length ? 'Candidates proposed' : (rejected.length ? 'Blocked — retrieval failed' : 'Queued'),
          candidates_found: (item.candidates_found || 0) + created.length,
          candidates_tested_ok: (item.candidates_tested_ok || 0) + created.length,
          topics_covered: coveredTopics,
          coverage_gaps: shortText(gapText, 900),
          last_run_id: runRef,
          last_run_at: new Date().toISOString(),
          block_reason: created.length ? '' : (rejected.length
            ? 'One or more proposed addresses could not be retrieved. This is an address-specific retrieval gap, not evidence that no instrument is published.'
            : 'No official source has been located yet. Research remains queued; this is not a finding that no requirement exists.'),
        });

        if (created.length) {
          await base44.asServiceRole.entities.Jurisdiction.update(jurisdiction?.id || '', {
            monitoring_status: 'Candidate sources awaiting verification',
          }).catch(() => {});
        }

        results.push({ jurisdiction: label, classification: item.internal_classification, candidates: created.length, tested_ok: created.length, rejected: rejected.length, topics_covered: coveredTopics.length, gaps: shortText(gapText, 200), sources: created });
      } catch (error) {
        failures.push({ jurisdiction: label, error: shortText(String(error?.message || error), 300) });
        await base44.asServiceRole.entities.DiscoveryQueue.update(item.id, {
          status: 'Blocked — retrieval failed',
          block_reason: shortText(String(error?.message || error), 400),
        }).catch(() => {});
      }
    }

    const remaining = queue.filter((q) => !candidatesForWork.some((c) => c.id === q.id) && ['Queued', 'Candidates proposed', 'Coverage partial', 'Blocked — retrieval failed'].includes(q.status)).length;
    const creditsEstimated = llmCalls;
    const finishedAt = new Date().toISOString();

    await base44.asServiceRole.entities.DiscoveryRun.create({
      run_ref: runRef,
      run_kind: 'Source discovery',
      trigger_type: triggerType,
      status: failures.length ? 'Partially completed' : 'Completed',
      batch_limit: limit,
      processed: candidatesForWork.length,
      candidates_created: candidatesCreated,
      candidates_tested_ok: testedOk,
      llm_calls: llmCalls,
      credits_estimated: creditsEstimated,
      credits_note: creditNote(llmCalls, 'Retrieval of publisher pages is part of the same batch and is not separately metered.'),
      started_at: startedAt,
      finished_at: finishedAt,
      notes: `Batch of ${candidatesForWork.length} jurisdiction(s); ${remaining} item(s) still queued or partially covered. Candidates stay pending verification.`,
      failures: failures.length ? JSON.stringify(failures) : '',
    });

    await base44.asServiceRole.entities.MonitoringConfig.update(config.id, {
      last_discovery_run_at: finishedAt,
      credits_used_note: 'Estimated from recorded AI calls in this app, assuming about 1 integration credit per call. Not read from billing.',
    });

    await logAudit(base44, actor, {
      event_type: 'Source discovery batch',
      entity_type: 'DiscoveryQueue',
      entity_id: runRef,
      entity_label: runRef,
      summary: `Researched ${candidatesForWork.length} jurisdiction(s): ${candidatesCreated} candidate source(s) retrieved and tested, ${failures.length} failure(s). All candidates await verification.`,
      detail: JSON.stringify(results.map((r) => ({ j: r.jurisdiction, c: r.candidates, gaps: r.gaps }))),
      recorded_by: 'runDiscoveryBatch',
    });

    return json({
      run_ref: runRef, trigger_type: triggerType, processed: candidatesForWork.length,
      candidates_created: candidatesCreated, llm_calls: llmCalls, credits_estimated: creditsEstimated,
      remaining, failures, results,
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}