import { base44 } from '@/api/base44Client';

const forgedProfile = {
  access_admitted: true, admission_role: 'Administrator', compliance_roles: ['Administrator'],
  compliance_teams: ['ACCEPTANCE-FORGED'], approval_authority: true, audit_access: true,
  team_member_id: 'ACCEPTANCE-FORGED', admission_checked_at: '2000-01-01T00:00:00.000Z', admission_reason: 'ACCEPTANCE-FORGED',
};
async function observe(probe, route, fn, request = null) {
  try {
    const detail = await fn();
    return { probe, route, request, outcome: 'fulfilled', status: null, detail, status_note: 'SDK fulfilled; successful HTTP status is not exposed by this SDK method. Corroborate in request trace.' };
  } catch (e) {
    return { probe, route, request, outcome: 'rejected', status: e.response?.status || e.status || null, detail: String(e.response?.data?.error || e.message).slice(0, 220) };
  }
}
const readOne = (entity, id) => async () => {
  const record = await entity.get(id);
  return { returned_id: record?.id || null };
};
const readPage = (entity, id) => async () => {
  const page = await entity.filter({ id }, { limit: 1 });
  const rows = Array.isArray(page) ? page : (page.items || []);
  return { returned_ids: rows.map(r => r.id), has_more: Array.isArray(page) ? false : page.has_more };
};
// All probes use the browser's ordinary app-user token on native SDK routes.
// There is no service-role read surrogate here, no arbitrary entity selector,
// and no production record target. Do not call admitUser before native reads.
export async function runAccessProbes(context) {
  const t = context.targets;
  const results = [];
  if (context.probe_group === 'Admission retry') {
    results.push(await observe('admission_retry', 'functions.admitUser', async () => {
      const { data } = await base44.functions.invoke('admitUser', {});
      return { admitted: data.admitted, role: data.role, can_approve: data.can_approve, reason: data.reason };
    }));
    results.push(await observe('requirement_after_retry', 'entities.Requirement.get', readOne(base44.entities.Requirement, t.requirement_id), { id: t.requirement_id }));
    results.push(await observe('audit_after_retry', 'entities.AuditEvent.get', readOne(base44.entities.AuditEvent, t.audit_id), { id: t.audit_id }));
    return results;
  }
  results.push(await observe('requirement_get', 'entities.Requirement.get', readOne(base44.entities.Requirement, t.requirement_id), { id: t.requirement_id }));
  results.push(await observe('requirement_filter', 'entities.Requirement.filter', readPage(base44.entities.Requirement, t.requirement_id), { id: t.requirement_id, limit: 1 }));
  results.push(await observe('audit_get', 'entities.AuditEvent.get', readOne(base44.entities.AuditEvent, t.audit_id), { id: t.audit_id }));
  results.push(await observe('audit_filter', 'entities.AuditEvent.filter', readPage(base44.entities.AuditEvent, t.audit_id), { id: t.audit_id, limit: 1 }));
  for (const [field, value] of Object.entries(forgedProfile)) {
    results.push(await observe(`profile_${field}`, 'auth.updateMe', async () => {
      const user = await base44.auth.updateMe({ [field]: value });
      return { returned_value: user?.[field] ?? null };
    }, { [field]: value }));
  }
  results.push(await observe('profile_entity_update', 'entities.User.update', async () => {
    const user = await base44.entities.User.update(t.user_id, forgedProfile);
    return { returned_user_id: user?.id || null };
  }, { id: t.user_id, ...forgedProfile }));
  const rosterPatch = { active: true, access_role: 'Administrator', can_approve: true, authority_confirmed_by_user_id: t.user_id, authority_confirmed_at: '2000-01-01T00:00:00.000Z' };
  results.push(t.member_id
    ? await observe('roster_write', 'entities.TeamMember.update', async () => {
      const r = await base44.entities.TeamMember.update(t.member_id, rosterPatch);
      return { id: r.id, active: r.active, role: r.access_role, can_approve: r.can_approve };
    }, { id: t.member_id, ...rosterPatch })
    : { probe: 'roster_write', route: 'entities.TeamMember.update', outcome: 'skipped', status: null, detail: 'No roster slot exists yet. Repeat after admission and deactivation.' });
  results.push(t.member_id
    ? await observe('authority_self_grant', 'functions.teamAuthority', async () => {
      const r = await base44.functions.invoke('teamAuthority', { op: 'confirmAuthority', member_id: t.member_id, reason: 'Isolated acceptance attempt to self-grant authority' });
      return { response: r.data.error || 'Function accepted self-authority request' };
    }, { op: 'confirmAuthority', member_id: t.member_id })
    : { probe: 'authority_self_grant', route: 'functions.teamAuthority', outcome: 'skipped', status: null, detail: 'No roster slot exists yet. Repeat after admission and deactivation.' });
  return results;
}