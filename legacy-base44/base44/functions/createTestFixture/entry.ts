import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, json } from '../../shared/compliance.ts';
import { pendingAcceptanceRows } from '../../shared/acceptancePlan.ts';

// Creates a CLEARLY LABELLED fixture so the review workflow and evidence chain can be
// exercised end-to-end without pretending a real monitoring run produced it.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const body = await req.json().catch(() => ({}));
    if (body.op === 'acceptancePlan') return json({ finding_status: 'Contained; native ordinary-user enforcement and open-session revocation unverified', tests: pendingAcceptanceRows(), fixture_status: 'Prepared unapproved; different named reviewer must be designated and sign in. No automatic reviewer and no third-person confirmation.' });
    if (body.op === 'acceptanceRequirement') {
      if (!actor.admitted || !actor.canAdministerRoles) return json({ error: 'Only a confirmed Compliance Administrator on the protected roster may prepare the isolated acceptance fixture.' }, 403);
      const existing = await base44.asServiceRole.entities.Requirement.filter({ acceptance_fixture: true, is_fixture: true }, { limit: 1 });
      if (existing.items.length) return json({ requirement: existing.items[0], status: 'Prepared; named reviewer and real two-person decision pending' });
      const requirement = await base44.asServiceRole.entities.Requirement.create({ requirement_id: `TEST-ACCEPTANCE-${crypto.randomUUID().slice(0,8)}`, title: '[TEST FIXTURE] Isolated two-person approval acceptance', category: 'A. Market Entry & Legal', jurisdiction_id: 'TEST-FIXTURE', jurisdiction_name: 'TEST FIXTURE, not a jurisdiction', territorial_scope: 'TEST FIXTURE ONLY', regulated_party: 'Unknown', product_type: 'Unknown', source_url: 'https://example.invalid/acceptance-fixture', source_version: 'Synthetic acceptance fixture v1', article_reference: 'Synthetic section 1', source_excerpt: 'TEST FIXTURE ONLY. This is fabricated acceptance material, not an official publication or business decision.', applicability_rationale: 'Synthetic test scope only; excluded from company requirements and coverage.', applicability_status: 'Under review', implementation_status: 'Unknown', approval_status: 'Candidate — unreviewed', current_version: 1, is_fixture: true, acceptance_fixture: true, ai_generated: false, drafter_user_id: actor.user.id, drafter_email: actor.email, contributor_user_ids: [actor.user.id] });
      await logAudit(base44, actor, { event_type: 'Acceptance fixture prepared', entity_type: 'Requirement', entity_id: requirement.id, summary: 'Isolated acceptance requirement prepared, unapproved and without any invented reviewer. A different named registered user must be explicitly designated, sign in and decide.', evidence_class: 'Preparation only, not a passed test or business decision', recorded_by: 'createTestFixture' });
      return json({ requirement, status: 'Prepared; named reviewer and real two-person decision pending' });
    }
    const jurisdictionId = body.jurisdiction_id;
    if (!jurisdictionId) return json({ error: 'jurisdiction_id is required' }, 400);
    const jurisdictions = await base44.asServiceRole.entities.Jurisdiction.filter({ jurisdiction_id: jurisdictionId });
    const jurisdiction = jurisdictions[0];
    if (!jurisdiction) return json({ error: 'Jurisdiction not found' }, 404);

    const now = new Date().toISOString();
    const document = await base44.asServiceRole.entities.DocumentRecord.create({
      document_ref: await nextRef(base44, 'DocumentRecord', 'document_ref', 'DOC', 5),
      source_id: 'TEST-FIXTURE',
      jurisdiction_name: jurisdiction.name,
      authority: 'TEST FIXTURE — not an official publication',
      title: '[TEST FIXTURE] Simulated amended technical standard',
      document_url: 'https://example.invalid/test-fixture/technical-standard-v2',
      document_type: 'Test fixture',
      language: 'English',
      version_label: 'Fixture v2',
      content_hash: 'fixture-hash',
      excerpt: 'TEST FIXTURE ONLY. This simulated passage exists to demonstrate change detection, alert review, requirement amendment, action and approval. It is not an official publication and must never be treated as evidence of a legal obligation.',
      fetched_at: now,
      first_seen_at: now,
      change_type: 'Replaced at same URL',
      extraction_status: 'Complete',
      extraction_note: 'Labelled test fixture — simulated extraction.',
      ocr_used: false,
      translation_status: 'Not required',
      translation_uncertain: false,
      diff_summary: 'Simulated change introduced by the test-fixture action.',
      is_fixture: true,
    });

    const alert = await base44.asServiceRole.entities.RegulatoryAlert.create({
      alert_ref: await nextRef(base44, 'RegulatoryAlert', 'alert_ref', 'ALT', 5),
      jurisdiction_id: jurisdiction.jurisdiction_id,
      jurisdiction_name: jurisdiction.name,
      authority: 'TEST FIXTURE — not an official publication',
      source_id: 'TEST-FIXTURE',
      document_id: document.id,
      document_url: document.document_url,
      document_version: document.version_label,
      title: '[TEST FIXTURE] Simulated technical standard amendment',
      summary: 'Labelled fixture used to test the review workflow.',
      what_changed: 'A simulated paragraph was amended.',
      why_it_matters: 'Demonstrates the path from a detected change to a requirement amendment and approval. Not a legal finding.',
      source_passages: ['TEST FIXTURE ONLY — simulated passage, not official wording.'],
      legal_stage: 'Unknown',
      detection_date: now.slice(0, 10),
      date_confidence: 'Not stated in source',
      previously_untracked: false,
      affected_products: ['Slot'],
      primary_owner_team: jurisdiction.primary_owner_team || 'Unassigned',
      collaborating_teams: [],
      priority: 'Low',
      review_status: 'Draft — unreviewed',
      assessment_outcome: 'Not assessed',
      ai_generated: false,
      linked_requirement_ids: [],
      linked_action_ids: [],
      notification_status: 'In-app only',
      is_fixture: true,
    });

    await base44.asServiceRole.entities.DocumentRecord.update(document.id, { alert_id: alert.id });

    await logAudit(base44, actor, {
      event_type: 'Test fixture created',
      entity_type: 'RegulatoryAlert',
      entity_id: alert.id,
      entity_label: alert.alert_ref,
      summary: `Labelled test fixture alert created for ${jurisdiction.name}.`,
      detail: 'Fixture records are marked is_fixture and are excluded from monitoring claims.',
      recorded_by: 'createTestFixture',
    });

    return json({ document_id: document.id, alert_id: alert.id, alert_ref: alert.alert_ref });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}