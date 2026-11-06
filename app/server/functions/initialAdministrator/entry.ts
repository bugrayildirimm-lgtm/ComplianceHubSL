import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { logAudit, json } from '../../shared/compliance.ts';
import { refreshAdmissionForUser } from '../../shared/admission.ts';

const ALLOWED_KEYS = ['op', 'user_id', 'confirm'];
const DESIGNATION_EVENT = 'Initial Administrator designated';

// One-time initial roster-administrator designation, used only from the trusted
// owner/editor setup context while no roster Administrator exists. It is not a
// public bootstrap endpoint, does not need a pre-existing administrator, and
// grants no admission exception: admission still comes from the roster alone.
// Approval authority is never touched, and existing team ownership is kept.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return json({ error: 'Sign-in required' }, 401);
    if (user.collaborator_role !== 'editor') {
      return json({ error: 'Initial designation is available only from the trusted owner/editor setup context. Use the controlled role-administration process instead.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.includes(k));
    if (extra.length) return json({ error: `Fields not accepted: ${extra.join(', ')}.` }, 400);
    if (!['preview', 'apply'].includes(body.op)) return json({ error: 'op must be preview or apply' }, 400);

    const E = base44.asServiceRole.entities;
    const members = (await E.TeamMember.list({ limit: 500 })).items || [];
    const existingAdmins = members.filter((m) => m.access_role === 'Administrator');
    const priorDesignations = await E.AuditEvent.filter({ event_type: DESIGNATION_EVENT }, { limit: 1 });
    const blocked = existingAdmins.length
      ? 'A roster Administrator already exists, so the one-time initial designation is closed. Use the existing controlled role-administration process.'
      : priorDesignations.length
        ? 'An initial designation was already recorded, so this one-time path is closed. Use the existing controlled role-administration process.'
        : null;

    if (!body.user_id) {
      return json({ error: 'user_id of the proposed account is required', available_members: members.map((m) => ({ user_id: m.user_id || null, user_email: m.user_email, access_role: m.access_role, active: m.active, teams: m.teams || [] })) }, 400);
    }

    const target = await E.User.get(String(body.user_id)).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!target) return json({ error: 'Proposed account is not a registered app user.' }, 404);

    const existing = members.filter((m) => String(m.user_email).toLowerCase() === String(target.email).toLowerCase());
    if (existing.length > 1) return json({ error: 'Duplicate roster entries exist for this address; resolve them first.' }, 409);
    const current = existing[0] || null;
    const proposal = {
      account: { user_id: target.id, email: target.email, full_name: target.full_name || '', app_role: target.role || '' },
      current_roster_entry: current ? {
        id: current.id, access_role: current.access_role, active: current.active,
        teams: current.teams || [], can_approve: current.can_approve === true,
        authority_confirmed_at: current.authority_confirmed_at || '', notes: current.notes || '',
      } : null,
      proposed_changes: {
        access_role: { from: current ? current.access_role : 'no roster entry', to: 'Administrator' },
        active: { from: current ? current.active : null, to: true },
        teams: { from: current ? (current.teams || []) : [], to: current ? (current.teams || []) : [], change: 'preserved unchanged' },
        can_approve: { from: current ? current.can_approve === true : false, to: current ? current.can_approve === true : false, change: 'unchanged — approval authority is never granted here' },
        authority_confirmation: { change: 'unchanged; still requires a different authorised person later' },
        admission: { change: 'none — admission remains roster-derived; no platform-admin exception added' },
      },
      grants: ['Roster Administrator: access-role administration for other registered users'],
      does_not_grant: ['Compliance-approval authority', 'Admission bypass for app-admin status', 'Any change to requirements, approvals or market decisions'],
      one_time: 'Closed after this designation is recorded; later appointments use the controlled role-administration process.',
      recorded_event: DESIGNATION_EVENT,
      blocked,
      no_change_applied: true,
    };

    if (body.op === 'preview') return json({ proposal, awaiting_confirmation: true });

    if (blocked) return json({ error: blocked }, 409);
    if (body.confirm !== true) return json({ error: 'Explicit confirmation for this exact account is required before applying.', proposal }, 400);

    const payload = {
      user_email: String(target.email).toLowerCase(),
      full_name: current?.full_name || target.full_name || '',
      access_role: 'Administrator',
      teams: current ? (current.teams || []) : [],
      active: true,
      user_id: target.id,
      notes: current?.notes || '',
    };
    const record = current
      ? await E.TeamMember.update(current.id, payload)
      : await E.TeamMember.create({ ...payload, can_approve: false });
    const decision = await refreshAdmissionForUser(base44, target.id);

    await logAudit(base44, { email: user.email, name: user.full_name || user.email, role: 'owner/editor setup context', user }, {
      event_type: DESIGNATION_EVENT,
      entity_type: 'TeamMember', entity_id: record.id, entity_label: payload.user_email,
      summary: `One-time initial Administrator designation for ${payload.user_email} from the owner/editor setup context. Teams preserved; approval authority unchanged (${record.can_approve ? 'held' : 'not held'}).`,
      detail: JSON.stringify({ proposal: proposal.proposed_changes, applied_by: user.email, decision }),
      evidence_class: 'Owner/editor bootstrap designation; not a compliance-approval decision',
      recorded_by: 'initialAdministrator',
    });

    return json({ member: record, admission: decision, status: 'Initial Administrator recorded; this one-time path is now closed.' });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}