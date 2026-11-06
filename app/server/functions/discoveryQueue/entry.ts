import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, json, shortText } from '../../shared/compliance.ts';
import { TARGET_TOPICS, priorityRank, isAmbiguousRecord } from '../../shared/discovery.ts';

const CATEGORIES = ['A. Market Entry & Legal', 'B. Slots Technical', 'C. Live Casino Game Technical', 'D. Live Studio & Operational'];

// Seeds (or refreshes) the resumable discovery queue and requirements baseline
// matrix from the master register. Nothing is discovered here.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const body = await req.json().catch(() => ({}));
    const jurisdictions = (await base44.asServiceRole.entities.Jurisdiction.list({ sort: 'jurisdiction_id', limit: 500 })).items
      || (await base44.asServiceRole.entities.Jurisdiction.list({ sort: 'jurisdiction_id', limit: 500 }));

    const queueExisting = await base44.asServiceRole.entities.DiscoveryQueue.list({ limit: 500 });
    const queueByJurisdiction = new Map((queueExisting.items || queueExisting || []).map((q) => [q.jurisdiction_id, q]));
    const baselineExisting = await base44.asServiceRole.entities.RequirementBaseline.list({ limit: 500 });
    const baselineKeys = new Set((baselineExisting.items || baselineExisting || []).map((b) => `${b.jurisdiction_id}|${b.category}`));
    const baselineCount = (baselineExisting.items || baselineExisting || []).length;

    const sources = await base44.asServiceRole.entities.Source.list({ limit: 500 });
    const sourceList = sources.items || sources || [];

    const newQueue = [];
    const queueUpdates = [];
    for (const jurisdiction of jurisdictions) {
      const ambiguous = isAmbiguousRecord(jurisdiction);
      const own = sourceList.filter((s) => s.jurisdiction_id === jurisdiction.jurisdiction_id && !s.is_fixture);
      const verified = own.filter((s) => s.verification_status === 'Verified');
      const topicsCovered = Array.from(new Set(verified.flatMap((s) => s.topics || [])));
      const existing = queueByJurisdiction.get(jurisdiction.jurisdiction_id);
      const rank = priorityRank(jurisdiction.internal_classification);

      const patch = {
        jurisdiction_name: jurisdiction.name,
        internal_classification: jurisdiction.internal_classification || 'Unknown',
        territory_scope: jurisdiction.territory_scope || '',
        priority_rank: rank,
        candidates_found: own.length,
        verified_sources: verified.length,
        topics_targeted: TARGET_TOPICS,
        topics_covered: topicsCovered,
      };

      if (ambiguous) {
        patch.status = 'Blocked — ambiguous register record';
        patch.block_reason = 'Source rows for this territory are held in a possible-duplicate group. Territorial scope must be resolved by a person before discovery runs, so no authority is inferred.';
      } else if (!existing) {
        patch.status = 'Queued';
        patch.attempts = 0;
        patch.candidates_found = own.length;
        patch.candidates_tested_ok = own.filter((s) => (s.retrieval_http_status || 0) === 200).length;
      } else if (['Researching'].includes(existing.status)) {
        patch.status = existing.status;
      } else if (verified.length) {
        patch.status = topicsCovered.length >= TARGET_TOPICS.length ? 'Verified sources available' : 'Coverage partial';
      } else if (own.length) {
        patch.status = 'Candidates proposed';
      } else if (existing.status === 'Blocked — budget or usage limit') {
        patch.status = existing.status;
        patch.block_reason = existing.block_reason;
      } else {
        patch.status = existing.status || 'Queued';
      }

      if (existing) queueUpdates.push({ id: existing.id, ...patch });
      else newQueue.push({ jurisdiction_id: jurisdiction.jurisdiction_id, ...patch });
    }

    if (newQueue.length) await base44.asServiceRole.entities.DiscoveryQueue.bulkCreate(newQueue);
    for (let i = 0; i < queueUpdates.length; i += 40) {
      await base44.asServiceRole.entities.DiscoveryQueue.bulkUpdate(queueUpdates.slice(i, i + 40));
    }

    // Baseline matrix: every resolved jurisdiction x the four requirement categories.
    const newBaselines = [];
    for (const jurisdiction of jurisdictions) {
      if (isAmbiguousRecord(jurisdiction)) continue;
      for (const category of CATEGORIES) {
        if (baselineKeys.has(`${jurisdiction.jurisdiction_id}|${category}`)) continue;
        baselineKeys.add(`${jurisdiction.jurisdiction_id}|${category}`);
        newBaselines.push({
          jurisdiction_id: jurisdiction.jurisdiction_id,
          jurisdiction_name: jurisdiction.name,
          category,
          internal_classification: jurisdiction.internal_classification || 'Unknown',
          priority_rank: priorityRank(jurisdiction.internal_classification),
          status: 'Not started',
          drafts_count: 0,
          attempts: 0,
        });
      }
    }
    for (let i = 0; i < newBaselines.length; i += 100) {
      await base44.asServiceRole.entities.RequirementBaseline.bulkCreate(newBaselines.slice(i, i + 100));
    }

    await logAudit(base44, actor, {
      event_type: 'Discovery queue seeded',
      entity_type: 'DiscoveryQueue',
      entity_id: 'queue',
      entity_label: 'Discovery queue',
      summary: `Queue now covers ${jurisdictions.length} jurisdiction(s); ${newQueue.length} added. Requirements baseline matrix gained ${newBaselines.length} row(s).`,
      recorded_by: 'discoveryQueue',
    });

    const queue = (await base44.asServiceRole.entities.DiscoveryQueue.list({ limit: 500 }));
    const queueItems = queue.items || queue || [];
    const byStatus = queueItems.reduce((acc, q) => { acc[q.status] = (acc[q.status] || 0) + 1; return acc; }, {});
    const baseline = await base44.asServiceRole.entities.RequirementBaseline.list({ limit: 500 });
    const baselineItems = baseline.items || baseline || [];
    const baselineByStatus = baselineItems.reduce((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {});

    return json({
      jurisdictions: jurisdictions.length,
      queue_total: queueItems.length,
      queue_added: newQueue.length,
      queue_by_status: byStatus,
      queue_by_rank: queueItems.reduce((acc, q) => { acc[`rank ${q.priority_rank}`] = (acc[`rank ${q.priority_rank}`] || 0) + 1; return acc; }, {}),
      baseline_total: baselineItems.length,
      baseline_by_status: baselineByStatus,
      queue_ready: queueItems.filter((q) => q.status === 'Queued').length,
      blocked: queueItems.filter((q) => /Blocked/.test(q.status)).map((q) => ({ jurisdiction: q.jurisdiction_name, reason: shortText(q.block_reason, 200) })),
      note: body.note ? shortText(body.note, 200) : '',
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}