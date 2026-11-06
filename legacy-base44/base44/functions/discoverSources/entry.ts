import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, shortText, json } from '../../shared/compliance.ts';
import { FETCH_MAINTENANCE } from '../../shared/protectedFetch.ts';

const SOURCE_TYPES = [
  'Regulator publication page', 'Technical standards', 'Legislation database', 'Official gazette',
  'Parliamentary bill or consultation', 'Court judgment', 'Enforcement publication', 'Other official',
];

export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);
    // Retrieves and tests candidate publisher URLs. Paused while no
    // connection-pinned protected-fetch transport exists.
    if (FETCH_MAINTENANCE.paused) return json({ ...FETCH_MAINTENANCE }, 503);
    const body = await req.json().catch(() => ({}));
    const targetIds = Array.isArray(body.jurisdiction_ids) ? body.jurisdiction_ids.slice(0, 5) : [];
    let targets = [];
    if (targetIds.length) {
      targets = await base44.asServiceRole.entities.Jurisdiction.filter({ jurisdiction_id: { $in: targetIds } });
    } else {
      const all = await base44.asServiceRole.entities.Jurisdiction.filter({});
      const existingSources = await base44.asServiceRole.entities.Source.filter({});
      const withSources = new Set(existingSources.map((s) => s.jurisdiction_id));
      targets = all.filter((j) => !withSources.has(j.jurisdiction_id)).slice(0, Number(body.limit) || 2);
    }

    if (!targets.length) {
      return json({
        created: 0,
        message: 'Every jurisdiction in the register already has proposed or verified sources. Select specific jurisdictions to discover additional sources.',
      });
    }

    const runId = body.run_id || `DISC-${new Date().toISOString().slice(0, 10)}-${Math.floor(Math.random() * 900 + 100)}`;
    const created = [];
    const failures = [];

    for (const jurisdiction of targets) {
      try {
        const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: [
            'You are helping a gambling supplier (slots, live casino games, live casino studios) find the ORIGINAL official regulatory sources it must monitor.',
            `Jurisdiction: ${jurisdiction.name}${jurisdiction.parent_jurisdiction ? ` (${jurisdiction.parent_jurisdiction})` : ''}. Internal classification: ${jurisdiction.internal_classification}.`,
            'Propose up to 5 official sources. Requirements:',
            '- Only governmental, regulator, official gazette, legislation database, parliament or court sources. Never law firms, media, consultancies or commercial feeds.',
            '- Prefer searchable publication pages over homepages, and pages where technical standards or consultations are actually published.',
            '- Cover different topics: licensing/market entry, game technical standards, live studio/premises rules, enforcement, legislation.',
            '- Use the local language for the source where that is the official version; state the language code/name.',
            '- Give the exact URL. If you are not certain a URL exists, omit it rather than guessing.',
            '- For each source give brief verification evidence: what it is and why the named authority is the publisher (e.g. "official site of the named regulator, publications section").',
            'Return JSON only.',
          ].join('\n'),
          add_context_from_internet: true,
          model: 'gemini_3_flash',
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
                    topics: { type: 'array', items: { type: 'string' } },
                    verification_evidence: { type: 'string' },
                    confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                  },
                  required: ['authority', 'url', 'source_type', 'verification_evidence'],
                },
              },
              note: { type: 'string' },
            },
            required: ['sources'],
          },
        });

        const proposals = Array.isArray(result?.sources) ? result.sources.slice(0, 5) : [];
        const existing = await base44.asServiceRole.entities.Source.filter({ jurisdiction_id: jurisdiction.jurisdiction_id });
        const knownUrls = new Set(existing.map((s) => s.url.replace(/\/$/, '')));

        for (const proposal of proposals) {
          if (!proposal?.url || !/^https?:\/\//i.test(proposal.url)) continue;
          if (knownUrls.has(proposal.url.replace(/\/$/, ''))) continue;
          knownUrls.add(proposal.url.replace(/\/$/, ''));
          const sourceType = SOURCE_TYPES.includes(proposal.source_type) ? proposal.source_type : 'Other official';
          const record = await base44.asServiceRole.entities.Source.create({
            source_id: await nextRef(base44, 'Source', 'source_id', 'SRC', 5),
            jurisdiction_id: jurisdiction.jurisdiction_id,
            jurisdiction_name: jurisdiction.name,
            authority: shortText(proposal.authority, 200),
            url: proposal.url,
            source_type: sourceType,
            language: proposal.language || 'Unknown',
            topics: Array.isArray(proposal.topics) ? proposal.topics.slice(0, 8) : [],
            collection_method: 'Direct page retrieval',
            check_frequency: 'Daily',
            priority: false,
            verification_status: 'Awaiting source verification',
            verification_evidence: `${proposal.verification_evidence || ''} (AI-assisted proposal, confidence ${proposal.confidence || 'Unstated'} — publishing authority must be confirmed by a person.)`,
            discovered_by: 'AI-assisted discovery',
            discovery_run_id: runId,
            health_status: 'Awaiting source verification',
            fetch_status: 'Not attempted',
            extraction_status: 'Not attempted',
            analysis_status: 'Not attempted',
            notification_status: 'Not applicable',
            consecutive_failures: 0,
            alert_count: 0,
          });
          created.push({ source_id: record.source_id, jurisdiction: jurisdiction.name, authority: record.authority, url: record.url });
        }

        await base44.asServiceRole.entities.Jurisdiction.update(jurisdiction.id, {
          monitoring_status: 'Sources awaiting verification',
        });
      } catch (error) {
        failures.push({ jurisdiction: jurisdiction.name, error: shortText(error?.message || 'Discovery failed', 300) });
      }
    }

    await logAudit(base44, actor, {
      event_type: 'Source discovery run',
      entity_type: 'Source',
      entity_id: runId,
      entity_label: runId,
      summary: `Discovery proposed ${created.length} candidate source(s) across ${targets.length} jurisdiction(s); all await verification.`,
      detail: failures.length ? JSON.stringify(failures) : '',
      recorded_by: 'discoverSources',
    });

    return json({ run_id: runId, jurisdictions_processed: targets.length, created: created.length, sources: created, failures });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}