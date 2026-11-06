import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, shortText, json } from '../../shared/compliance.ts';

export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Write access is required to record an audit entry.' }, 403);

    const body = await req.json().catch(() => ({}));
    if (!body.summary) return json({ error: 'summary is required' }, 400);

    const event = await base44.asServiceRole.entities.AuditEvent.create({
      event_type: 'Client report — unverified',
      entity_type: shortText(body.entity_type || '', 80),
      entity_id: String(body.entity_id || ''),
      entity_label: shortText(body.entity_label || '', 200),
      summary: shortText(body.summary, 1000),
      detail: shortText(body.detail || '', 4000),
      actor_email: actor.email,
      actor_name: actor.name,
      actor_role: actor.role,
      recorded_by: 'logAudit: unverified client statement',
      actor_user_id: actor.user.id,
      app_role: actor.user.role,
      workspace_role: actor.user.collaborator_role || '',
      evidence_class: 'Unverified client report; never decision evidence',
      occurred_at: new Date().toISOString(),
    });

    return json({ ok: true, event_id: event.id });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}