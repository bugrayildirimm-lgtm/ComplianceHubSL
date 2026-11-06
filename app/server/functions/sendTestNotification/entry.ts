import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, json, shortText } from '../../shared/compliance.ts';

// Sends a clearly labelled test notification (in-app and email) to the signed-in
// authorised user only, and records whether delivery succeeded.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const configs = await base44.asServiceRole.entities.MonitoringConfig.filter({ config_key: 'default' });
    const config = configs[0] || null;
    const runRef = await nextRef(base44, 'DiscoveryRun', 'run_ref', 'DRUN', 5);
    const startedAt = new Date().toISOString();
    const title = `TEST NOTIFICATION ${runRef} — not a regulatory alert`;
    const body = 'This is a labelled delivery test from the Compliance Hub. It confirms the notification channel reaches the responsible user. It is not evidence of any regulatory development.';

    await base44.asServiceRole.entities.Notification.create({
      title,
      body,
      severity: 'Informational',
      link_path: '/sources',
      read: false,
      delivery_channel: 'In-app',
      delivery_status: 'Delivered in-app',
    });

    let emailResult = null;
    let emailStatus = 'Failed';
    try {
      emailResult = await base44.asServiceRole.integrations.Core.SendEmail({
        to: actor.email,
        from_name: 'STAKELOGIC COMPLIANCE HUB (TEST)',
        subject: `[TEST] ${title}`,
        text: `${body}\n\nRecipient: ${actor.email}\nSent: ${new Date().toISOString()}\nReference: ${runRef}\n\nThis message was requested by ${actor.name} to test notification delivery.`,
        category: 'transactional',
      });
      emailStatus = emailResult?.success === false ? 'Failed' : 'Sent to the signed-in user';
    } catch (error) {
      emailStatus = `Failed: ${shortText(String(error?.message || error), 200)}`;
    }

    await base44.asServiceRole.entities.DiscoveryRun.create({
      run_ref: runRef,
      run_kind: 'Notification test',
      trigger_type: 'Manual',
      status: emailStatus.startsWith('Failed') ? 'Partially completed' : 'Completed',
      processed: 1,
      llm_calls: 0,
      credits_estimated: 0,
      credits_note: 'In-app notification plus one transactional email to the signed-in user.',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      notes: `In-app notification recorded; email ${emailStatus}. Recipient: ${actor.email}.`,
    });

    if (config) {
      await base44.asServiceRole.entities.MonitoringConfig.update(config.id, {
        external_notification_status: emailStatus.startsWith('Failed') ? 'Failed' : 'Configured and tested',
        notification_test_note: `${runRef}: in-app delivered; email ${emailStatus} to ${actor.email} at ${new Date().toISOString()}. This tests delivery only, not the recipient's accountability for the alert.`,
      });
    }

    await logAudit(base44, actor, {
      event_type: 'Notification delivery test',
      entity_type: 'Notification',
      entity_id: runRef,
      entity_label: title,
      summary: `Labelled test notification sent to ${actor.email}; email delivery ${emailStatus}.`,
      recorded_by: 'sendTestNotification',
    });

    return json({ run_ref: runRef, in_app: 'Delivered in-app', email: emailStatus, recipient: actor.email, email_result: emailResult });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}