import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, json } from '../../shared/compliance.ts';
import { validRequirementApproval } from '../../shared/approvalIntegrity.ts';

// Every figure is counted from stored records at request time. Nothing here is a
// narrative total, and nothing is inferred from an attempted research run.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.admitted) return json({ error: 'Your account is not admitted to this compliance workspace.' }, 403);

    const [imports, jurisdictions, sources, queue, baselines, requirements, versions, attempts, runs, approvals] = await Promise.all([
      base44.asServiceRole.entities.ImportRow.list({ limit: 500 }),
      base44.asServiceRole.entities.Jurisdiction.list({ limit: 500 }),
      base44.asServiceRole.entities.Source.list({ limit: 500 }),
      base44.asServiceRole.entities.DiscoveryQueue.list({ limit: 500 }),
      base44.asServiceRole.entities.RequirementBaseline.list({ limit: 500 }),
      base44.asServiceRole.entities.Requirement.list({ limit: 500 }),
      base44.asServiceRole.entities.RequirementVersion.list({ limit: 500 }),
      base44.asServiceRole.entities.DiscoveryAttempt.list({ limit: 500 }),
      base44.asServiceRole.entities.DiscoveryRun.list({ limit: 200 }),
      base44.asServiceRole.entities.Approval.list({ limit: 500 }),
    ]);
    const rows = imports.items || [];
    const master = jurisdictions.items || [];
    const sourceRows = sources.items || [];
    const live = sourceRows.filter((s) => !s.is_fixture);
    const queueRows = queue.items || [];
    const cells = baselines.items || [];
    const reqs = (requirements.items || []).filter(r => !r.is_fixture);
    const attemptsRows = attempts.items || [];
    const runRows = runs.items || [];

    let validApprovals = 0;
    for (const r of reqs.filter(r => r.approval_status === 'Approved')) if (await validRequirementApproval(base44, r)) validApprovals++;
    const classOf = (name) => (master.find((j) => j.name === name) || {}).internal_classification || 'Unknown';
    const withCandidates = new Set(live.map((s) => s.jurisdiction_id));
    const withVerified = new Set(live.filter((s) => s.verification_status === 'Verified').map((s) => s.jurisdiction_id));
    const countByClass = (set) => {
      const acc = { 'Licensed Jurisdiction': 0, 'Conditionally Permitted': 0, 'Prospective': 0, 'Prohibited Territory': 0, Other: 0 };
      for (const row of master) {
        if (!set.has(row.jurisdiction_id)) continue;
        const key = Object.keys(acc).find((k) => row.internal_classification === k) || 'Other';
        acc[key] += 1;
      }
      return acc;
    };

    const unlinked = rows.filter((r) => !r.promoted_jurisdiction_id);
    const promotionCounts = rows.reduce((acc, r) => { if (r.promoted_jurisdiction_id) acc[r.promoted_jurisdiction_id] = (acc[r.promoted_jurisdiction_id] || 0) + 1; return acc; }, {});

    return json({
      generated_at: new Date().toISOString(),
      basis: 'Stored records at request time; up to 500 records per entity (200 research runs). Cursor flags expose any incomplete report scope.',
      report_scope_complete: ![imports,jurisdictions,sources,queue,baselines,requirements,versions,attempts,runs,approvals].some(p => p.has_more),
      imported_rows: {
        total: rows.length,
        valid: rows.filter((r) => r.validation_status === 'Valid').length,
        promoted_linked: rows.length - unlinked.length,
        distinct_master_records_from_import: Object.keys(promotionCounts).length,
        unlinked_held_rows: unlinked.map((r) => ({ row: r.import_row_key, source_row: r.source_row, name: r.jurisdiction_name_raw, decision: r.review_decision, reason: (r.validation_notes || []).join(' '), duplicate_group: r.duplicate_review_group || '' })),
        master_records_updated_by_more_than_one_row: Object.entries(promotionCounts).filter(([, n]) => n > 1).map(([id, n]) => ({ jurisdiction_id: id, rows: n })),
      },
      master: {
        total: master.length,
        imported_master: Object.keys(promotionCounts).length,
        manual_or_other: master.length - Object.keys(promotionCounts).length,
      },
      research_progress: {
        attempted_jurisdictions: queueRows.filter((q) => (q.attempts || 0) > 0).length,
        untouched_jurisdictions: queueRows.filter((q) => !(q.attempts || 0)).length,
        jurisdictions_with_candidates: withCandidates.size,
        jurisdictions_with_verified_source: withVerified.size,
        candidates_by_classification: countByClass(withCandidates),
        verified_by_classification: countByClass(withVerified),
        queue_status_totals: queueRows.reduce((a, q) => { a[q.status] = (a[q.status] || 0) + 1; return a; }, {}),
      },
      sources: {
        retained_source_records: live.length,
        unique_candidate_urls: new Set(live.map((s) => String(s.url).replace(/\/$/, ''))).size,
        cumulative_proposals_recorded_across_runs: runRows.filter((r) => r.run_kind === 'Source discovery').reduce((a, r) => a + (r.candidates_created || 0), 0),
        awaiting_verification: live.filter((s) => s.verification_status === 'Awaiting source verification').length,
        verified: live.filter((s) => s.verification_status === 'Verified').length,
        rejected: live.filter((s) => s.verification_status === 'Rejected').length,
        failed_or_blocked: live.filter((s) => s.health_status === 'Failed or blocked').length,
        fixtures_excluded: sourceRows.length - live.length,
      },
      discovery_attempts: {
        total: attemptsRows.length,
        failed: attemptsRows.filter((a) => ['Retrieval failed', 'Access blocked', 'Not accepted — not an official publisher'].includes(a.outcome)).length,
        by_outcome_class: attemptsRows.reduce((a, x) => { a[x.outcome_class || 'Unclassified'] = (a[x.outcome_class || 'Unclassified'] || 0) + 1; return a; }, {}),
      },
      requirements: {
        research_workstream_cells: cells.length,
        cells_by_status: cells.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {}),
        requirement_records: reqs.length,
        candidates_unreviewed: reqs.filter((r) => r.approval_status === 'Candidate — unreviewed').length,
        in_review: reqs.filter((r) => r.approval_status === 'In review').length,
        approved: reqs.filter((r) => r.approval_status === 'Approved').length,
        approved_with_valid_version_and_decision: validApprovals,
        versions_recorded: versions.items ? versions.items.length : 0,
        approvals_open: approvals.items ? approvals.items.filter((a) => a.decision === 'Pending').length : 0,
        approvals_decided: approvals.items ? approvals.items.filter((a) => a.decision !== 'Pending').length : 0,
        label: 'Cells are research-workstream coverage, not a count of legal requirements.',
      },
      scheduled_execution: runRows.filter((r) => r.trigger_type === 'Workflow').map((r) => ({ run_ref: r.run_ref, kind: r.run_kind, started_at: r.started_at, finished_at: r.finished_at, processed: r.processed, status: r.status })),
      scheduled_workflow_runs_found: runRows.filter((r) => r.trigger_type === 'Workflow').length,
      note_on_schedules: 'Trigger labels are caller-supplied metadata, not scheduled-execution proof. Match each research run to the actual platform workflow run ID. On-demand invocations do not establish scheduled baseline acceptance.',
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}