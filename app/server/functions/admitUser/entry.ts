import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { evaluateRoster } from '../../shared/accessPolicy.ts';
import { rosterFor, claimRosterEntry, persistAdmission } from '../../shared/admission.ts';
import { json } from '../../shared/compliance.ts';

// Admission control. A signed-in account is admitted only while the compliance
// roster holds exactly one active entry for that address, bound to this account.
// Platform app-role is never an admission route. This endpoint re-reads the
// roster and persists a mirror. Native direct entity reads use that mirror in
// RLS without looking up TeamMember; open-session revocation is not yet proven.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return json({ error: 'Sign-in required' }, 401);

    const matches = await rosterFor(base44, user.email);
    const claimed = await claimRosterEntry(base44, matches, user);
    const decision = evaluateRoster(claimed, user);
    await persistAdmission(base44, user, decision);

    if (!decision.admitted) {
      return json({
        admitted: false,
        reason: decision.reason,
        role: 'Read-only',
        can_write: false,
        can_approve: false,
        can_audit: false,
        roster_conflict: decision.reason === 'conflicting_roster_entries',
        checked_at: new Date().toISOString(),
      });
    }

    return json({
      admitted: true,
      reason: decision.reason,
      role: decision.role,
      can_write: decision.canWrite,
      can_approve: decision.canApprove,
      can_audit: decision.canReadAudit,
      can_administer_roles: decision.canAdministerRoles,
      teams: Array.isArray(decision.member?.teams) ? decision.member.teams : [],
      member: decision.member,
      roster_conflict: false,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}