import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, json } from '../../shared/compliance.ts';
import { refreshAdmissionForEmail, refreshAdmissionForUser } from '../../shared/admission.ts';

const ROLES = ['Administrator', 'Regulatory Compliance', 'Technical Compliance', 'Approver', 'Read-only'];
const ALLOWED = ['op', 'member_id', 'user_email', 'full_name', 'access_role', 'teams', 'active', 'notes', 'reason'];

// Role assignment is a protected operation. Nobody may change their own role or
// approval authority, and approval authority only exists once a different
// authorised person confirms it.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    const body = await req.json().catch(() => ({}));
    const extra = Object.keys(body).filter((k) => !ALLOWED.includes(k));
    if (extra.length) return json({ error: `Fields not accepted: ${extra.join(', ')}.` }, 400);

    // Role administration requires a confirmed Compliance Administrator on the
    // roster. Platform app-role, including app admin, grants nothing here.
    if (!actor.admitted || !actor.canAdministerRoles) {
      return json({ error: 'Only a confirmed Compliance Administrator on the protected roster may change access roles.' }, 403);
    }
    if (!body.reason || String(body.reason).trim().length < 10) {
      return json({ error: 'Record why this access change is being made (at least 10 characters).' }, 400);
    }

    const op = body.op;

    if (op === 'assign') {
      if (!body.user_email) return json({ error: 'user_email is required' }, 400);
      if (!ROLES.includes(body.access_role)) return json({ error: 'Unknown access role' }, 400);
      const email = String(body.user_email).toLowerCase();
      if (email === String(actor.email).toLowerCase()) {
        return json({ error: 'You cannot change your own access role. Another authorised person must do it.' }, 403);
      }
      const existing = await base44.asServiceRole.entities.TeamMember.filter({ user_email: email });
      if (existing.length > 1) return json({ error: 'Duplicate TeamMember records exist for this address; resolve them before assigning a role.' }, 409);
      const users = await base44.asServiceRole.entities.User.list();
      const matched = (users || []).find((u) => String(u.email).toLowerCase() === email);
      if (!matched) return json({ error: 'That address is not a registered app user yet. Invite them first.' }, 400);

      const payload = {
        user_email: email, full_name: body.full_name || matched.full_name || '',
        access_role: body.access_role, teams: Array.isArray(body.teams) ? body.teams : [],
        active: body.active !== false, notes: body.notes || '', user_id: matched.id,
      };
      // Deactivation/read-only assignment also revokes existing approval authority.
      // Re-activation must not silently restore it; a new deliberate confirmation is needed.
      if (!payload.active || payload.access_role === 'Read-only') {
        Object.assign(payload, { can_approve: false, authority_confirmed_by_user_id: '', authority_confirmed_at: '' });
      }
      let record;
      if (existing.length) {
        // Authority is never granted by the same call that assigns a role.
        if (existing[0].user_id !== matched.id) payload.user_id = matched.id;
        record = await base44.asServiceRole.entities.TeamMember.update(existing[0].id, payload);
      } else {
        record = await base44.asServiceRole.entities.TeamMember.create({ ...payload, can_approve: false });
      }
      await refreshAdmissionForEmail(base44, email);
      await logAudit(base44, actor, {
        event_type: existing.length ? 'Access role changed' : 'Access role assigned', entity_type: 'TeamMember',
        entity_id: email, entity_label: payload.full_name || email,
        summary: `${email} set to ${payload.access_role}, active=${payload.active}; approval authority ${!payload.active || payload.access_role === 'Read-only' ? 'revoked' : 'not granted by role assignment'} (${record.can_approve ? 'held' : 'not held'}). Reason: ${body.reason}`,
        recorded_by: 'teamAuthority',
      });
      return json({ member: record });
    }

    if (op === 'confirmAuthority' || op === 'revokeAuthority') {
      if (!body.member_id) return json({ error: 'member_id is required' }, 400);
      const member = await base44.asServiceRole.entities.TeamMember.get(String(body.member_id)).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!member) return json({ error: 'Team member not found' }, 404);
      if (member.user_id === actor.user.id || String(member.user_email).toLowerCase() === String(actor.email).toLowerCase()) {
        return json({ error: 'You cannot grant or revoke your own approval authority. A different authorised person must confirm it.' }, 403);
      }
      if (!member.user_id) return json({ error: 'This member has no linked app user; re-assign the role first.' }, 400);
      if (op === 'confirmAuthority' && (member.active !== true || member.access_role === 'Read-only')) {
        return json({ error: 'Approval authority requires an active, non-read-only roster member.' }, 409);
      }
      const patch = op === 'confirmAuthority'
        ? { can_approve: true, authority_confirmed_by_user_id: actor.user.id, authority_confirmed_at: new Date().toISOString() }
        : { can_approve: false, authority_confirmed_by_user_id: '', authority_confirmed_at: '' };
      const updated = await base44.asServiceRole.entities.TeamMember.update(member.id, patch);
      // Backend operations re-check the current roster. Native reads depend on
      // this mirror write; its propagation to an open session needs acceptance.
      await refreshAdmissionForUser(base44, member.user_id);
      await logAudit(base44, actor, {
        event_type: op === 'confirmAuthority' ? 'Approval authority confirmed' : 'Approval authority revoked',
        entity_type: 'TeamMember', entity_id: member.user_email, entity_label: member.full_name || member.user_email,
        summary: `${actor.email} ${op === 'confirmAuthority' ? 'confirmed' : 'revoked'} approval authority for ${member.user_email}. Reason: ${body.reason}`,
        evidence_class: 'Human appointment of approval authority',
        recorded_by: 'teamAuthority',
      });
      return json({ member: updated });
    }

    return json({ error: 'Unsupported operation' }, 400);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}