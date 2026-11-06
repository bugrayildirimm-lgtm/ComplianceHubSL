// Pure authorisation logic for the Compliance Hub. No I/O, so it can be tested
// directly by the security self-test harness. The compliance roster is the only
// source of admission; platform app-role never admits anyone.

export const ACCESS_ROLES = ['Administrator', 'Regulatory Compliance', 'Technical Compliance', 'Approver', 'Read-only'];
export const WORKING_ROLES = ['Administrator', 'Regulatory Compliance', 'Technical Compliance', 'Approver'];

const normalize = (value) => String(value || '').trim().toLowerCase();

// Returns a full decision. Every failure carries a reason and denies access.
export function evaluateRoster(roster, user) {
  const deny = (reason) => ({
    admitted: false, reason, member: null, role: 'Read-only',
    canWrite: false, canApprove: false, canAdministerRoles: false, canReadAudit: false,
  });

  if (!user) return deny('not_signed_in');
  const email = normalize(user.email);
  if (!email) return deny('no_verified_email');

  const list = Array.isArray(roster) ? roster : [];
  const matches = list.filter((m) => normalize(m?.user_email) === email);
  if (matches.length === 0) return deny('no_roster_entry');
  // Conflicting entries are never resolved by picking one.
  if (matches.length > 1) return deny('conflicting_roster_entries');

  const member = matches[0];
  if (member.active !== true) return deny('roster_entry_inactive');
  if (!ACCESS_ROLES.includes(member.access_role)) return deny('unknown_access_role');
  if (!member.user_id) return deny('roster_entry_unbound');
  if (String(member.user_id) !== String(user.id)) return deny('roster_entry_bound_elsewhere');

  const role = member.access_role;
  const canApprove = member.can_approve === true
    && member.user_id === user.id
    && Boolean(member.authority_confirmed_at)
    && Boolean(member.authority_confirmed_by_user_id)
    && member.authority_confirmed_by_user_id !== user.id
    && role !== 'Read-only';

  return {
    admitted: true,
    reason: 'roster_entry_active_and_bound',
    member,
    role,
    canWrite: role !== 'Read-only',
    canApprove,
    canAdministerRoles: role === 'Administrator',
    canReadAudit: role !== 'Read-only',
  };
}

// Server-written mirror used by native direct-read RLS. Native reads do not
// re-read TeamMember; only backend operations using resolveActor/admitUser do.
// Propagation of this mirror to an already-open ordinary-user session needs
// real native-route acceptance; a unit-level roster decision cannot prove it.
export function admissionFields(user, decision) {
  const member = decision.member;
  return {
    access_admitted: Boolean(decision.admitted),
    admission_role: decision.role,
    compliance_roles: member ? [member.access_role] : [],
    compliance_teams: Array.isArray(member?.teams) ? member.teams : [],
    approval_authority: Boolean(decision.canApprove),
    audit_access: Boolean(decision.canReadAudit),
    team_member_id: member?.id || '',
    admission_checked_at: new Date().toISOString(),
    admission_reason: decision.reason,
  };
}