// Admission persistence. The protected roster is authoritative to backend
// checks. Native reads rely on this user-record mirror; propagation into an
// already-open native session has not been established by ordinary-user tests.
import { evaluateRoster, admissionFields } from './accessPolicy.ts';

export async function rosterFor(base44, email) {
  const page = await base44.asServiceRole.entities.TeamMember.filter({});
  const list = page?.items || page || [];
  const target = String(email || '').trim().toLowerCase();
  return list.filter((m) => String(m.user_email || '').trim().toLowerCase() === target);
}

async function userFor(base44, userId) {
  const page = await base44.asServiceRole.entities.User.filter({ id: userId });
  return (page?.items || page || [])[0] || null;
}

// Binds an unbound roster entry to the first account that proves the address.
export async function claimRosterEntry(base44, matches, user) {
  if (matches.length !== 1) return matches;
  const member = matches[0];
  if (member.user_id || member.active !== true) return matches;
  const bound = await base44.asServiceRole.entities.TeamMember.update(member.id, { user_id: user.id });
  return [bound];
}

export async function persistAdmission(base44, user, decision) {
  if (!user) return null;
  const fields = admissionFields(user, decision);
  const unchanged = Object.keys(fields).every((key) => key === 'admission_checked_at' || user[key] === fields[key]);
  if (unchanged) return null;
  return await base44.asServiceRole.entities.User.update(user.id, fields);
}

// Recomputes and stores the admission mirror from the current roster. Role
// administration awaits this write; open-session native enforcement still
// needs independent acceptance. No claim of per-read roster lookup is made.
export async function refreshAdmissionForUser(base44, userId) {
  const user = await userFor(base44, userId);
  if (!user) return null;
  const decision = evaluateRoster(await rosterFor(base44, user.email), user);
  await persistAdmission(base44, user, decision);
  return decision;
}

export async function refreshAdmissionForEmail(base44, email) {
  const matches = await rosterFor(base44, email);
  for (const member of matches) {
    if (member.user_id) await refreshAdmissionForUser(base44, member.user_id);
  }
}