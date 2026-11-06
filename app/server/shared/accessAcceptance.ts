// Narrow acceptance-only observations. Never a compliance read gateway.
// User claims in evidence come from auth.me(); native browser responses remain
// explicitly client-observed until the Testing Agent/IT reviews request traces.
import { rosterFor } from './admission.ts';
import { evaluateRoster } from './accessPolicy.ts';
import { sha256 } from './compliance.ts';

export const protectedProfileFields = ['access_admitted', 'admission_role', 'compliance_roles', 'compliance_teams', 'approval_authority', 'audit_access', 'team_member_id', 'admission_checked_at', 'admission_reason'];
export const probeNames = ['requirement_get', 'requirement_filter', 'audit_get', 'audit_filter', ...protectedProfileFields.map(f => `profile_${f}`), 'profile_entity_update', 'roster_write', 'authority_self_grant', 'admission_retry', 'requirement_after_retry', 'audit_after_retry'];
const pick = (record, keys) => Object.fromEntries(keys.map(k => [k, record?.[k] ?? null]));
const missing = e => e.status === 404 ? null : Promise.reject(e);
export const ordinary = user => user.role === 'user' && !user.collaborator_role;
export const identity = (user, actor) => ({
  ...pick(user, ['id', 'email', 'role', 'collaborator_role']),
  admitted: actor.admitted, roster_role: actor.role, reason: actor.reason,
  can_write: actor.canWrite, can_approve: actor.canApprove, can_administer_roles: actor.canAdministerRoles, can_read_audit: actor.canReadAudit,
  non_editor_limit: 'Absence of a collaborator claim alone is not independent proof; preparation must record IT verification of no workspace/editor privileges.',
});
export async function snapshot(base44, user, manifest) {
  const E = base44.asServiceRole.entities;
  const [storedUser, roster, requirement, audit] = await Promise.all([
    E.User.get(user.id), rosterFor(base44, user.email),
    E.Requirement.get(manifest.requirement_record_id).catch(missing),
    E.AuditEvent.get(manifest.audit_record_id).catch(missing),
  ]);
  return {
    at: new Date().toISOString(),
    profile: pick(storedUser, ['id', 'role', ...protectedProfileFields]),
    authentication_claim_profile: pick(user, protectedProfileFields),
    roster: roster.map(m => pick(m, ['id', 'user_id', 'active', 'access_role', 'can_approve', 'authority_confirmed_at', 'authority_confirmed_by_user_id'])),
    current_decision: identity(user, evaluateRoster(roster, user)),
    fixture_requirement: requirement ? { id: requirement.id, is_fixture: requirement.is_fixture, title: requirement.title, approval_status: requirement.approval_status, updated_date: requirement.updated_date } : null,
    fixture_audit: audit ? { id: audit.id, digest: await sha256(JSON.stringify(audit)), updated_date: audit.updated_date } : null,
  };
}
export function publicEvidence(record) {
  return pick(record, ['id', 'kind', 'run_id', 'test_user_id', 'test_user_email', 'stage', 'probe_group', 'state', 'stop_required', 'started_at', 'finished_at', 'identity_json', 'before_json', 'after_json', 'request_results_json', 'evidence_class', 'preparation_reason', 'non_editor_confirmation']);
}
export async function prepareAccessFixtures(base44, actor, target, reason, confirmation) {
  const E = base44.asServiceRole.entities;
  const runId = `ACCESS-${crypto.randomUUID()}`;
  const req = await E.Requirement.create({
    requirement_id: runId, title: '[TEST FIXTURE] Ordinary-user native access canary', category: 'A. Market Entry & Legal',
    jurisdiction_id: 'TEST-FIXTURE', jurisdiction_name: 'TEST FIXTURE', is_fixture: true, acceptance_fixture: false,
    approval_status: 'Candidate — unreviewed', applicability_status: 'Unknown', implementation_status: 'Unknown',
    source_excerpt: 'Synthetic access-control canary only. Not legal evidence, not for approval.',
    drafter_user_id: actor.user.id, drafter_email: actor.email, ai_generated: false,
  });
  const audit = await E.AuditEvent.create({
    event_type: 'Access acceptance fixture prepared', entity_type: 'Requirement', entity_id: req.id, entity_label: runId,
    summary: `${runId}: synthetic native-read canary prepared; no access or approval authority granted.`,
    actor_email: actor.email, actor_user_id: actor.user.id, actor_role: actor.role,
    evidence_class: 'Synthetic acceptance canary; preparation only', recorded_by: 'accessAcceptance', occurred_at: new Date().toISOString(),
  });
  return await E.AccessAcceptance.create({
    kind: 'Fixture set', run_id: runId, test_user_id: target.id, test_user_email: target.email,
    prepared_by_user_id: actor.user.id, preparation_reason: reason, non_editor_confirmation: confirmation,
    requirement_record_id: req.id, audit_record_id: audit.id, state: 'Prepared',
    evidence_class: 'Prepared only; no passed checks, no human decision or monitoring evidence',
  });
}