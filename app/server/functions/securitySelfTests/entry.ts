import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, json } from '../../shared/compliance.ts';
import { evaluateRoster, ACCESS_ROLES } from '../../shared/accessPolicy.ts';
import { outboundDecision, FETCH_MAINTENANCE } from '../../shared/protectedFetch.ts';

// Repeatable, isolated checks for the shared authorisation and outbound-request
// logic. Fixtures only: no records are created, changed or deleted, and no
// network request is made. These are unit-level checks and cannot substitute for
// platform enforcement tests with a genuine non-editor identity.

const base = (over = {}) => ({
  id: 'm1', user_id: 'u1', user_email: 'person@example.com', active: true,
  access_role: 'Regulatory Compliance', teams: [], can_approve: false,
  authority_confirmed_at: '', authority_confirmed_by_user_id: '', ...over,
});
const user = (over = {}) => ({ id: 'u1', email: 'person@example.com', role: 'user', ...over });

function runCase(name, fn, expect) {
  let actual;
  try { actual = fn(); } catch (error) { actual = { thrown: error.message }; }
  const passed = expect(actual);
  return { name, passed, actual: JSON.stringify(actual) };
}

export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    // The harness is a protected read-only operation: admitted roster members
    // with write access. It writes no records and makes no network request.
    if (!actor.admitted || !actor.canWrite) {
      return json({ error: 'An admitted roster member with write access is required to run the security self-tests.' }, 403);
    }

    const cases = [
      runCase('active, bound roster entry is admitted', () => {
        const d = evaluateRoster([base()], user());
        return { admitted: d.admitted, canWrite: d.canWrite };
      }, (a) => a.admitted === true && a.canWrite === true),

      runCase('missing roster entry is denied, even for platform admin', () => {
        const d = evaluateRoster([], user({ role: 'admin' }));
        return { admitted: d.admitted, reason: d.reason };
      }, (a) => a.admitted === false && a.reason === 'no_roster_entry'),

      runCase('inactive roster entry is denied for platform admin', () => {
        const d = evaluateRoster([base({ active: false })], user({ role: 'admin' }));
        return { admitted: d.admitted, reason: d.reason };
      }, (a) => a.admitted === false && a.reason === 'roster_entry_inactive'),

      runCase('conflicting roster entries are denied', () => {
        const d = evaluateRoster([base(), base({ id: 'm2', access_role: 'Administrator' })], user());
        return { admitted: d.admitted, reason: d.reason };
      }, (a) => a.admitted === false && a.reason === 'conflicting_roster_entries'),

      runCase('entry bound to another account is denied', () => {
        const d = evaluateRoster([base({ user_id: 'u2' })], user());
        return { admitted: d.admitted, reason: d.reason };
      }, (a) => a.admitted === false && a.reason === 'roster_entry_bound_elsewhere'),

      runCase('unbound roster entry is not admitted before claiming', () => {
        const d = evaluateRoster([base({ user_id: '' })], user());
        return { admitted: d.admitted, reason: d.reason };
      }, (a) => a.admitted === false && a.reason === 'roster_entry_unbound'),

      runCase('unknown access role is denied', () => {
        const d = evaluateRoster([base({ access_role: 'Superuser' })], user());
        return { admitted: d.admitted, reason: d.reason };
      }, (a) => a.admitted === false && a.reason === 'unknown_access_role'),

      runCase('read-only role may read but never write, administer roles or approve', () => {
        const d = evaluateRoster([base({ access_role: 'Read-only' })], user({ role: 'admin' }));
        return { admitted: d.admitted, canWrite: d.canWrite, canAdministerRoles: d.canAdministerRoles, canApprove: d.canApprove, canReadAudit: d.canReadAudit };
      }, (a) => a.admitted === true && a.canWrite === false && a.canAdministerRoles === false && a.canApprove === false && a.canReadAudit === false),

      runCase('working role writes without administration or approval', () => {
        const d = evaluateRoster([base()], user());
        return { canWrite: d.canWrite, canAdministerRoles: d.canAdministerRoles, canApprove: d.canApprove };
      }, (a) => a.canWrite === true && a.canAdministerRoles === false && a.canApprove === false),

      runCase('roster Administrator administers roles but holds no approval authority', () => {
        const d = evaluateRoster([base({ access_role: 'Administrator' })], user());
        return { canAdministerRoles: d.canAdministerRoles, canApprove: d.canApprove };
      }, (a) => a.canAdministerRoles === true && a.canApprove === false),

      runCase('self-confirmed approval authority is not accepted', () => {
        const d = evaluateRoster([base({ can_approve: true, authority_confirmed_at: '2026-01-01T00:00:00Z', authority_confirmed_by_user_id: 'u1' })], user());
        return { canApprove: d.canApprove };
      }, (a) => a.canApprove === false),

      runCase('second-person confirmed approval authority is accepted', () => {
        const d = evaluateRoster([base({ can_approve: true, authority_confirmed_at: '2026-01-01T00:00:00Z', authority_confirmed_by_user_id: 'u9' })], user());
        return { canApprove: d.canApprove };
      }, (a) => a.canApprove === true),

      runCase('forged profile admission fields grant nothing without a roster entry', () => {
        const forged = user({ role: 'admin', access_admitted: true, admission_role: 'Administrator', approval_authority: true, audit_access: true, team_member_id: 'forged' });
        const d = evaluateRoster([], forged);
        return { admitted: d.admitted, canWrite: d.canWrite, canApprove: d.canApprove };
      }, (a) => a.admitted === false && a.canWrite === false && a.canApprove === false),

      runCase('stale admission copy is overridden by a deactivated roster entry', () => {
        const stale = user({ access_admitted: true, admission_role: 'Regulatory Compliance' });
        const d = evaluateRoster([base({ active: false })], stale);
        return { admitted: d.admitted };
      }, (a) => a.admitted === false),

      runCase('every declared access role is recognised', () => ACCESS_ROLES.length === 5, (a) => a === true),

      runCase('outbound request is refused while fetch containment is active', () => {
        return { decision: outboundDecision('https://example.gov/publication'), paused: FETCH_MAINTENANCE.paused };
      }, (a) => a.paused === true && a.decision?.allowed === false),
    ];

    const fixtures = [
      { label: 'public https publication page', url: 'https://example.gov/publication' },
      { label: 'cloud metadata endpoint', url: 'http://169.254.169.254/latest/meta-data/' },
      { label: 'loopback address', url: 'http://127.0.0.1:8080/admin' },
      { label: 'private range', url: 'http://10.0.0.5/internal' },
      { label: 'non-http scheme', url: 'file:///etc/passwd' },
      { label: 'redirect target', url: 'https://example.gov/redirect-to-internal' },
    ];
    for (const fixture of fixtures) {
      cases.push(runCase(`outbound refused: ${fixture.label}`, () => outboundDecision(fixture.url, { hop: 'redirect' }), (a) => a.allowed === false));
    }

    const failures = cases.filter((c) => !c.passed);
    return json({
      ran_at: new Date().toISOString(),
      scope: 'Isolated unit checks of shared authorisation and outbound-request logic. No records written, no network request made.',
      not_covered: [
        'Platform enforcement of User custom-field write locks on the profile-update route (needs a genuine non-editor account).',
        'Direct-entity-read denial for a deactivated roster entry from an already-open browser session (needs a genuine non-roster account).',
        'Second-reviewer approval acceptance (needs a second designated reviewer).',
      ],
      total: cases.length,
      passed: cases.length - failures.length,
      failed: failures.length,
      cases,
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}