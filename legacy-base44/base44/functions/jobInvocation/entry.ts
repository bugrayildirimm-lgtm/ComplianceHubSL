import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { logAudit, json } from '../../shared/compliance.ts';

const JOB = 'boundedCollectionJob';
const ALLOWED_KEYS = ['op'];
const NO_NETWORK_NOTE = 'Invocation test only: no publisher, document or other outbound request is made. Publisher fetching stays paused behind the protected-fetch stop guard.';

// Dedicated job entry point using the documented platform model: a workflow
// step runs as its creator, an app-admin business account, authenticated by
// base44.auth.me(). That is NOT a separate machine identity or a scheduler-
// exclusive credential — it is the real invoking account, which is why the
// account is recorded on every run.
//
// Authorisation is a second, server-controlled gate: the authenticated account
// must be the designated active job runner in monitoring configuration. General
// app-admin status alone grants nothing here, and this function never grants
// admission, business-data reads, role administration or approval authority.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  const startedAt = new Date().toISOString();
  const runRef = `JOB-${crypto.randomUUID()}`;
  try {
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return json({ error: 'Sign-in required' }, 401);

    const body = await req.json().catch(() => ({}));
    const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.includes(k));
    if (extra.length) {
      return json({ error: `Fields not accepted: ${extra.join(', ')}. This entry point accepts no caller-supplied operations, scope, source identifiers or privileged actions.` }, 400);
    }
    if (body.op && body.op !== 'invokeNoNetworkTest') {
      return json({ error: 'Unsupported operation. Only the fixed no-network invocation test exists.' }, 400);
    }

    const configs = await base44.asServiceRole.entities.MonitoringConfig.filter({ config_key: 'default' });
    const config = configs[0] || null;
    const designatedId = String(config?.job_runner_user_id || '');
    const checks = {
      platform_authenticated: true,
      app_role_admin: user.role === 'admin',
      designated_job_runner: Boolean(designatedId) && designatedId === String(user.id),
      designation_active: config?.job_runner_active === true,
    };
    const allowed = checks.app_role_admin && checks.designated_job_runner && checks.designation_active;
    const authorizationDetail = `app_role_admin=${checks.app_role_admin}; designated_job_runner=${checks.designated_job_runner}; designation_active=${checks.designation_active}; designated_account=${config?.job_runner_email || 'none'}`;
    const identity = {
      invoking_user_id: user.id, invoking_user_email: user.email,
      invoking_app_role: user.role || '', invoking_collaborator_role: user.collaborator_role || '',
    };

    if (!allowed) {
      const result = !checks.app_role_admin
        ? 'Rejected — not an app-admin identity'
        : !checks.designated_job_runner
          ? 'Rejected — not the designated job runner'
          : 'Rejected — designation inactive';
      const rejected = await base44.asServiceRole.entities.JobInvocation.create({
        run_ref: runRef, job_name: JOB, ...identity, authorization_result: result,
        authorization_detail: authorizationDetail,
        trigger_context: 'Not asserted by the request. The request carried no scheduler attestation; only the platform run history can distinguish a scheduled invocation from a manual one.',
        network_requests: 0, status: 'Rejected', started_at: startedAt, finished_at: new Date().toISOString(),
        notes: 'Unauthorised invocation rejected before any job work. No record, queue, decision or role was changed.',
      });
      await logAudit(base44, { email: user.email, name: user.full_name || user.email, role: 'unauthorised job caller', user }, {
        event_type: 'Job invocation rejected', entity_type: 'JobInvocation', entity_id: rejected.id, entity_label: runRef,
        summary: `${user.email} attempted ${JOB} and was rejected: ${result}.`,
        detail: authorizationDetail,
        evidence_class: 'Server-recorded rejection; identity is the authenticated caller',
        recorded_by: 'jobInvocation',
      });
      return json({ run_ref: runRef, authorized: false, reason: result, detail: authorizationDetail }, 403);
    }

    // Server-selected queued work only. Reads are bounded counts and one record
    // identifier; nothing is fetched, approved or reassigned.
    const nowIso = new Date().toISOString();
    const [verifiedSources, dueQueue, baselineCells, nextSource] = await Promise.all([
      base44.asServiceRole.entities.Source.count({ verification_status: 'Verified', is_fixture: { $ne: true } }),
      base44.asServiceRole.entities.DiscoveryQueue.count({ status: { $in: ['Queued'] } }),
      base44.asServiceRole.entities.RequirementBaseline.count({ status: { $in: ['Queued', 'Not started'] } }),
      base44.asServiceRole.entities.Source.filter({ verification_status: 'Verified', is_fixture: { $ne: true } }, { sort: 'next_check_at', limit: 1 }),
    ]);
    const next = nextSource.items[0] || null;
    const scope = {
      verified_sources: verifiedSources,
      discovery_queue_pending: dueQueue,
      baseline_cells_pending: baselineCells,
      next_server_selected_source: next ? { source_id: next.source_id, authority: next.authority, due_at: next.next_check_at || null } : null,
      documents_fetched: 0,
      queue_items_claimed: 0,
      approvals_touched: 0,
      roles_touched: 0,
      market_decisions_touched: 0,
      evaluated_at: nowIso,
    };

    const completed = await base44.asServiceRole.entities.JobInvocation.create({
      run_ref: runRef, job_name: JOB, ...identity,
      authorization_result: 'Authorised job runner', authorization_detail: authorizationDetail,
      trigger_context: 'Not asserted by the request. The request carried no scheduler attestation; only the platform run history can distinguish a scheduled invocation from a manual one.',
      network_requests: 0, observed_scope_json: JSON.stringify(scope), status: 'Completed',
      started_at: startedAt, finished_at: new Date().toISOString(),
      notes: NO_NETWORK_NOTE,
    });

    await logAudit(base44, { email: user.email, name: user.full_name || user.email, role: 'designated job runner', user }, {
      event_type: 'Job invocation completed', entity_type: 'JobInvocation', entity_id: completed.id, entity_label: runRef,
      summary: `${JOB} ran as ${user.email} (designated job runner). ${scope.verified_sources} verified source(s), ${scope.discovery_queue_pending} queued discovery item(s); 0 documents fetched.`,
      detail: JSON.stringify(scope),
      evidence_class: 'Server-recorded job run; establishes invocation authorisation and scheduler behaviour only, not protected retrieval',
      recorded_by: 'jobInvocation',
    });

    return json({
      run_ref: runRef, authorized: true, job: JOB, invoking_identity: identity,
      authorization_detail: authorizationDetail, network_requests: 0, observed_scope: scope,
      retrieval: 'Publisher retrieval remains paused; this run establishes invocation authorisation only.',
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}