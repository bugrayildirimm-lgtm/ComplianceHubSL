import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, shortText, json } from '../../shared/compliance.ts';
import { testCandidateSource, publisherEvidence } from '../../shared/discovery.ts';
import { FETCH_MAINTENANCE } from '../../shared/protectedFetch.ts';

// Official starting points confirmed by the compliance owner. They replace an
// unsupported "no retrievable material" conclusion; a retrieval failure here is
// recorded as a scoped gap, never as proof that no instrument exists.
const STARTING_POINTS = {
  'JUR-0037': {
    name: 'Pennsylvania',
    urls: [
      { url: 'https://www.pacodeandbulletin.gov/secure/pacode/data/058/chapter810a/chap810atoc.html', authority: 'Pennsylvania Code and Bulletin (Legislative Reference Bureau)', source_type: 'Legislation database', topics: ['Slots technical standards', 'Live casino technical standards', 'Market entry and licensing'] },
      { url: 'https://gamingcontrolboard.pa.gov/gaming-law-and-regulations/final-published-regulations', authority: 'Pennsylvania Gaming Control Board', source_type: 'Regulator publication page', topics: ['Market entry and licensing', 'Live studio and premises rules'] },
    ],
  },
  'JUR-0035': {
    name: 'Rhode Island',
    urls: [
      { url: 'https://www.rilot.com/en-us/about-us/lottery-rules.html', authority: 'Rhode Island Lottery', source_type: 'Regulator publication page', topics: ['Market entry and licensing', 'Enforcement and sanctions'] },
      { url: 'https://webserver.rilegislature.gov/Statutes/TITLE42/42-61.2/42-61.2-17.htm', authority: 'Rhode Island General Assembly (General Laws)', source_type: 'Legislation database', topics: ['Market entry and licensing', 'Live casino technical standards'] },
    ],
  },
};

export default async function (req) {
  const base44 = createClientFromRequest(req);
  let stage = 'start';
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);
    // Retrieves publisher pages. Paused while no connection-pinned
    // protected-fetch transport exists.
    if (FETCH_MAINTENANCE.paused) return json({ ...FETCH_MAINTENANCE }, 503);
    const body = await req.json().catch(() => ({}));
    const codes = Array.isArray(body.jurisdiction_ids) && body.jurisdiction_ids.length
      ? body.jurisdiction_ids.filter((id) => STARTING_POINTS[id]) : Object.keys(STARTING_POINTS);
    if (!codes.length) return json({ error: 'No supported jurisdiction in the request' }, 400);

    stage = 'run-ref';
    const runRef = await nextRef(base44, 'DiscoveryRun', 'run_ref', 'DRUN', 5);
    const startedAt = new Date().toISOString();
    stage = 'existing-sources';
    const existing = await base44.asServiceRole.entities.Source.filter({});
    const known = new Set(existing.map((s) => String(s.url || '').replace(/\/$/, '')));
    const results = [];

    for (const code of codes) {
      const config = STARTING_POINTS[code];
      const label = config.name;
      const jurisdictionRow = { territory_scope: 'Subnational state or province' };
      const created = [];
      const failures = [];

      for (const point of config.urls) {
        const key = point.url.replace(/\/$/, '');
        if (known.has(key)) { results.push({ jurisdiction: label, url: point.url, outcome: 'Already recorded' }); continue; }
        stage = `probe:${point.url}`;
        const probe = await testCandidateSource(point.url);
        const retrieved = probe.ok && !probe.blocked;
        stage = `attempt:${point.url}`;
        await base44.asServiceRole.entities.DiscoveryAttempt.create({
          run_ref: runRef, jurisdiction_id: code, jurisdiction_name: label, origin: 'Official starting point',
          url: point.url, attempted_at: new Date().toISOString(), attempted_by: actor.email,
          outcome: retrieved ? 'Retrieved and recorded as candidate' : probe.blocked ? 'Access blocked' : 'Retrieval failed',
          outcome_class: retrieved ? 'Source awaiting verification' : probe.blocked ? 'Source found but retrieval blocked' : 'Source not yet found',
          http_status: Number(probe.status) || 0,
          detail: shortText(`${probe.error || ''} ${probe.is_pdf ? 'PDF document; wording extraction not configured.' : ''} ${probe.title ? `Page title: ${probe.title}` : ''}`.trim(), 500),
        });
        if (!retrieved) {
          failures.push({ url: point.url, http: probe.status || 0, error: probe.error || (probe.blocked ? 'access blocked' : 'not retrievable') });
          continue;
        }
        known.add(key);
        stage = `source-create:${point.url}`;
        const record = await base44.asServiceRole.entities.Source.create({
          source_id: await nextRef(base44, 'Source', 'source_id', 'SRC', 5),
          jurisdiction_id: code, jurisdiction_name: label, authority: point.authority, url: point.url,
          source_type: point.source_type, language: probe.is_pdf ? 'Unknown' : 'English',
          topics: point.topics, subject_coverage: point.topics,
          territorial_scope: jurisdictionRow.territory_scope,
          retrieval_http_status: probe.status,
          retrieval_result: `HTTP ${probe.status} · ${probe.is_pdf ? 'PDF' : 'HTML'} · ${probe.bytes} bytes · retrieved ${startedAt.slice(0, 16).replace('T', ' ')} UTC`,
          retrieval_tested_at: startedAt, retrieval_page_title: shortText(probe.title, 240),
          publisher_evidence: publisherEvidence(point.url, probe, point.authority),
          collection_method: probe.is_pdf ? 'Not configured' : 'Direct page retrieval',
          check_frequency: 'Daily', priority: true,
          verification_status: 'Awaiting source verification',
          verification_evidence: 'Supplied by the compliance owner as an official starting point. Publisher authority and topic coverage still require a human verification decision.',
          discovered_by: `Official starting point (${actor.email})`, discovery_run_id: runRef,
          health_status: 'Awaiting source verification',
          fetch_status: 'Retrieved during discovery',
          extraction_status: probe.is_pdf ? 'Pending — PDF text extraction not configured' : 'Retrieved text available',
          analysis_status: 'Not analysed (candidate)', notification_status: 'Not applicable',
          consecutive_failures: 0, alert_count: 0,
        });
        created.push({ source_id: record.source_id, url: record.url, http: probe.status, title: shortText(probe.title, 120) });
      }

      const queueRows = await base44.asServiceRole.entities.DiscoveryQueue.filter({ jurisdiction_id: code });
      const queue = queueRows[0] || null;
      const correctedReason = `Previous status "Blocked — retrieval failed" was not supported: a failed search or 404 on one document does not establish that no official material is published. Corrected on ${startedAt.slice(0, 10)} using official starting points supplied by the compliance owner. ${failures.length ? `Still unresolved at these addresses: ${failures.map((f) => `${f.url} (HTTP ${f.http}${f.error ? `, ${f.error}` : ''})`).join(' | ')}` : 'All supplied starting points retrieved.'}`;
      if (queue) {
        await base44.asServiceRole.entities.DiscoveryQueue.update(queue.id, {
          status: created.length ? 'Candidates proposed' : 'Blocked — retrieval failed',
          candidates_found: (queue.candidates_found || 0) + created.length,
          candidates_tested_ok: (queue.candidates_tested_ok || 0) + created.length,
          topics_covered: Array.from(new Set(created.flatMap((c) => config.urls.filter((u) => u.url === c.url).flatMap((u) => u.topics)))),
          coverage_gaps: shortText(correctedReason, 900),
          block_reason: created.length ? '' : correctedReason,
          last_run_id: runRef, last_run_at: new Date().toISOString(),
        });
      }
      results.push({ jurisdiction: label, jurisdiction_id: code, created: created.length, failures, sources: created, corrected_status: created.length ? 'Candidates proposed' : 'Blocked — retrieval failed' });
    }

    await base44.asServiceRole.entities.DiscoveryRun.create({
      run_ref: runRef, run_kind: 'Source discovery', trigger_type: 'Manual',
      status: results.some((r) => r.failures.length) ? 'Partially completed' : 'Completed',
      processed: codes.length, candidates_created: results.reduce((a, r) => a + r.created, 0),
      started_at: startedAt, finished_at: new Date().toISOString(),
      notes: 'Correction run: official starting points for markets previously marked unavailable. Candidates await human verification; legal applicability is not inferred.',
      failures: JSON.stringify(results.flatMap((r) => r.failures)),
    });

    await logAudit(base44, actor, {
      event_type: 'Blocked-market conclusion corrected', entity_type: 'DiscoveryQueue', entity_id: runRef,
      entity_label: codes.join(', '),
      summary: `Corrected the unsupported "no retrievable material" conclusion for ${results.map((r) => r.jurisdiction).join(' and ')}: ${results.reduce((a, r) => a + r.created, 0)} official starting point(s) recorded as candidates, ${results.reduce((a, r) => a + r.failures.length, 0)} address-specific failure(s) retained in the attempt ledger.`,
      evidence_class: 'Server retrieval evidence; verification still requires a human decision',
      recorded_by: 'correctMarketBlock',
    });

    return json({ run_ref: runRef, executed_at: startedAt, results });
  } catch (error) {
    return json({ error: error.message, stage }, 500);
  }
}