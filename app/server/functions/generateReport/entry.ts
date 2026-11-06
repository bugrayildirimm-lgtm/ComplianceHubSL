import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, json } from '../../shared/compliance.ts';

function monthBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { start: start.toISOString(), end: end.toISOString() };
}

export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const body = await req.json().catch(() => ({}));
    const bounds = monthBounds();
    const periodStart = body.period_start || bounds.start;
    const periodEnd = body.period_end || bounds.end;
    const inPeriod = (iso) => Boolean(iso) && iso >= periodStart && iso <= periodEnd;
    const today = new Date().toISOString().slice(0, 10);

    const [jurisdictions, importRows, baselineCells, discoveryAttempts, sources, jobs, documents, alerts, requirements, actions, teamMembers] = await Promise.all([
      base44.asServiceRole.entities.Jurisdiction.filter({}),
      base44.asServiceRole.entities.ImportRow.filter({}),
      base44.asServiceRole.entities.RequirementBaseline.filter({}),
      base44.asServiceRole.entities.DiscoveryAttempt.filter({}),
      base44.asServiceRole.entities.Source.filter({}),
      base44.asServiceRole.entities.CollectionJob.filter({}),
      base44.asServiceRole.entities.DocumentRecord.filter({}),
      base44.asServiceRole.entities.RegulatoryAlert.filter({}),
      base44.asServiceRole.entities.Requirement.filter({}),
      base44.asServiceRole.entities.ActionItem.filter({}),
      base44.asServiceRole.entities.TeamMember.filter({}),
    ]);

    const verifiedSources = sources.filter((s) => s.verification_status === 'Verified');
    const unverifiedSources = sources.filter((s) => s.verification_status === 'Awaiting source verification');
    const operationalSources = verifiedSources.filter((s) => s.last_success_at);
    const failedSources = sources.filter((s) => s.health_status === 'Failed or blocked');
    const stale = verifiedSources.filter((s) => s.last_success_at && (Date.now() - Date.parse(s.last_success_at)) > 3 * 86400000);

    const jobsInPeriod = jobs.filter((j) => inPeriod(j.finished_at) || inPeriod(j.started_at));
    const docsInPeriod = documents.filter((d) => inPeriod(d.fetched_at));
    const alertsInPeriod = alerts.filter((a) => inPeriod(a.created_date) || inPeriod(a.detection_date));

    const byKey = (list, key) => list.reduce((acc, item) => {
      const value = String(item[key] || 'Unknown');
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

    const overdueActions = actions.filter((a) => a.due_date && a.due_date < today && !['Closed'].includes(a.status));
    const upcomingActions = actions.filter((a) => a.due_date && a.due_date >= today && a.due_date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) && a.status !== 'Closed');
    const unassignedOwnership = jurisdictions.filter((j) => j.ownership_status !== 'Assigned' || !j.primary_owner_user && j.primary_owner_team === 'Unassigned');
    const jurisdictionsWithoutVerifiedSource = jurisdictions.filter((j) => !verifiedSources.some((s) => s.jurisdiction_id === j.jurisdiction_id));
    const approvedRequirements = requirements.filter((r) => r.approval_status === 'Approved');
    const requirementsApprovedInPeriod = approvedRequirements.filter((r) => inPeriod(r.approval_date));
    const missingEvidence = approvedRequirements.filter((r) => r.implementation_status === 'Unknown');

    const topics = ['Market entry', 'Slots technical', 'Live casino technical', 'Live studio operational', 'Enforcement', 'Legislation', 'Consultations'];
    const coveredTopics = topics.map((topic) => ({
      topic,
      covered: new Set(verifiedSources.filter((s) => (s.topics || []).join(' ').toLowerCase().includes(topic.toLowerCase())).map((s) => s.jurisdiction_id)).size,
      total: jurisdictions.length,
    }));

    const sections = {
      period: { start: periodStart, end: periodEnd },
      monitoring_coverage: {
        imported_rows: importRows.length,
        imported_rows_linked_to_master: importRows.filter((r) => r.promoted_jurisdiction_id).length,
        unlinked_import_rows: importRows.filter((r) => !r.promoted_jurisdiction_id).map((r) => r.import_row_key),
        resolved_jurisdictions: jurisdictions.length,
        research_workstream_cells: baselineCells.length,
        research_cells_note: 'Cells are jurisdiction-by-category research coverage, not a count of legal requirements.',
        discovery_attempts_recorded: discoveryAttempts.length,
        discovery_attempts_failed: discoveryAttempts.filter((a) => a.outcome_class && a.outcome_class !== 'Source awaiting verification').length,
        figures_timestamp: new Date().toISOString(),
        verified_sources: verifiedSources.length,
        unverified_sources: unverifiedSources.length,
        operational_sources: operationalSources.length,
        failed_sources: failedSources.length,
        stale_sources: stale.length,
        jurisdictions_without_verified_source: jurisdictionsWithoutVerifiedSource.length,
        collection_runs: new Set(jobsInPeriod.map((j) => j.run_id)).size,
        checks_completed: jobsInPeriod.filter((j) => ['Succeeded', 'Partially processed'].includes(j.status)).length,
        checks_failed: jobsInPeriod.filter((j) => j.status === 'Failed or blocked').length,
        topic_coverage: coveredTopics,
      },
      developments: {
        documents_collected: docsInPeriod.length,
        documents_changed_at_same_url: docsInPeriod.filter((d) => d.change_type === 'Replaced at same URL').length,
        alerts_prepared: alertsInPeriod.length,
        alerts_by_legal_stage: byKey(alertsInPeriod, 'legal_stage'),
        alerts_previously_untracked: alertsInPeriod.filter((a) => a.previously_untracked).length,
        alerts_by_priority: byKey(alertsInPeriod, 'priority'),
      },
      review_decisions: {
        assessed: alertsInPeriod.filter((a) => a.assessment_outcome !== 'Not assessed').length,
        pending_assessment: alerts.filter((a) => a.assessment_outcome === 'Not assessed').length,
        outcomes: byKey(alertsInPeriod.filter((a) => a.assessment_outcome !== 'Not assessed'), 'assessment_outcome'),
      },
      requirements: {
        approved_total: approvedRequirements.length,
        approved_in_period: requirementsApprovedInPeriod.length,
        candidates_unreviewed: requirements.filter((r) => r.approval_status === 'Candidate — unreviewed').length,
        by_category: byKey(requirements, 'category'),
        by_applicability: byKey(requirements, 'applicability_status'),
        by_implementation: byKey(requirements, 'implementation_status'),
        approved_without_implementation_status: missingEvidence.length,
      },
      deadlines: {
        upcoming_30_days: upcomingActions.map((a) => ({ ref: a.action_ref, title: a.title, due: a.due_date, owner: a.owner_team })),
        overdue: overdueActions.map((a) => ({ ref: a.action_ref, title: a.title, due: a.due_date, owner: a.owner_team })),
      },
      unresolved_gaps: {
        ownership_review_queue: unassignedOwnership.length,
        jurisdictions_without_verified_source: jurisdictionsWithoutVerifiedSource.slice(0, 40).map((j) => j.name),
        sources_failed: failedSources.map((s) => ({ jurisdiction: s.jurisdiction_name, url: s.url, reason: s.failure_reason })),
        sources_awaiting_verification: unverifiedSources.length,
        team_members_configured: teamMembers.length,
      },
    };

    const summary = [
      `${sections.monitoring_coverage.checks_completed} checks completed across ${sections.monitoring_coverage.verified_sources} verified source(s)`,
      `${sections.developments.alerts_prepared} draft alert(s) prepared for review`,
      `${sections.review_decisions.assessed} impact assessment(s) recorded`,
      `${sections.requirements.approved_in_period} requirement(s) approved`,
      `${sections.deadlines.overdue.length} overdue action(s)`,
      `${sections.unresolved_gaps.ownership_review_queue} jurisdiction(s) awaiting explicit ownership`,
      `${sections.unresolved_gaps.jurisdictions_without_verified_source} jurisdiction(s) with no verified official source`,
    ].join(' · ');

    const reportRef = await nextRef(base44, 'Report', 'report_ref', 'RPT', 4);
    const report = await base44.asServiceRole.entities.Report.create({
      report_ref: reportRef,
      report_type: 'Month-end',
      period_start: periodStart,
      period_end: periodEnd,
      generated_at: new Date().toISOString(),
      generated_by: actor.email,
      sections_json: JSON.stringify(sections),
      summary,
      scope_note: 'Generated from recorded collection jobs, documents and review decisions. It does not claim regulatory completeness: gaps, unverified sources and undetected publications remain possible.',
      is_fixture: false,
    });

    await logAudit(base44, actor, {
      event_type: 'Report generated',
      entity_type: 'Report',
      entity_id: report.id,
      entity_label: reportRef,
      summary: `Month-end report ${reportRef} generated for ${periodStart.slice(0, 10)} to ${periodEnd.slice(0, 10)}.`,
      recorded_by: 'generateReport',
    });

    return json({ report });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}