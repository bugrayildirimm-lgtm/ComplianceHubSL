import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, json, sha256 } from '../../shared/compliance.ts';
import { rosterFor } from '../../shared/admission.ts';
import { ordinary, identity, snapshot, publicEvidence, prepareAccessFixtures, probeNames, protectedProfileFields } from '../../shared/accessAcceptance.ts';

const stages = ['Not admitted', 'Admitted read-only', 'Deactivated'];
const keys = {
  list: ['op', 'cursor'], prepare: ['op', 'email', 'reason', 'non_editor_confirmation'],
  evidence: ['op', 'manifest_id', 'cursor'], begin: ['op', 'manifest_id', 'stage', 'probe_group'],
  finish: ['op', 'observation_id', 'results'],
};
const missing = e => e.status === 404 ? null : Promise.reject(e);
// This diagnostic intentionally permits the assigned, signed-in test subject
// after revocation. It exposes only their own identity and isolated canaries,
// never protected business records or a general entity/query service.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    const text = await req.text();
    if (text.length > 22000) return json({ error: 'Acceptance request too large' }, 413);
    let body;
    try { body = JSON.parse(text || '{}'); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object' || !Object.hasOwn(keys, body.op)) return json({ error: 'Unknown acceptance operation' }, 400);
    if (Object.keys(body).some(k => !keys[body.op].includes(k))) return json({ error: 'Unsupported acceptance fields' }, 400);
    if (body.cursor && (typeof body.cursor !== 'string' || body.cursor.length > 2048)) return json({ error: 'Invalid continuation' }, 400);
    const E = base44.asServiceRole.entities;
    const admin = actor.admitted && actor.canAdministerRoles;
    if (body.op === 'list') {
      const page = await E.AccessAcceptance.filter({ kind: 'Fixture set', ...(admin ? {} : { test_user_id: actor.user.id }) }, { sort: '-created_date', limit: 10, ...(body.cursor ? { cursor: body.cursor } : {}) });
      return json({ identity: identity(actor.user, actor), can_prepare: admin, ordinary_candidate: ordinary(actor.user), items: page.items.map(publicEvidence), has_more: page.has_more, next_cursor: page.next_cursor });
    }
    if (body.op === 'prepare') {
      if (!admin) return json({ error: 'A current roster Administrator must prepare the isolated test. Platform app-admin status grants no permission.' }, 403);
      const email = String(body.email || '').trim().toLowerCase();
      const reason = String(body.reason || '').trim();
      const confirmation = String(body.non_editor_confirmation || '').trim();
      if (!email || email.length > 254 || reason.length < 10 || reason.length > 1000 || confirmation.length < 20 || confirmation.length > 1000) return json({ error: 'Provide the registered test email, reason, and IT evidence confirming no workspace/collaborator/editor privileges.' }, 400);
      const targets = await E.User.filter({ email });
      const target = targets[0];
      if (!target) return json({ error: 'The ordinary test user must first join through App Users. No user is created here.' }, 404);
      if (target.id === actor.user.id || !ordinary(target)) return json({ error: 'Use a separate role=user identity with no collaborator/editor privileges, never the operator account.' }, 409);
      if ((await rosterFor(base44, target.email)).length) return json({ error: 'Start with a new isolated test identity that has no roster entry. Existing memberships are not reset.' }, 409);
      if (await E.AccessAcceptance.count({ kind: 'Fixture set', test_user_id: target.id })) return json({ error: 'This subject already has a prepared fixture set. Reuse it; evidence is never reset.' }, 409);
      const record = await prepareAccessFixtures(base44, actor, target, reason, confirmation);
      return json({ fixture: publicEvidence(record), status: 'Prepared only; no admission or approval authority granted' });
    }
    if (body.op === 'finish') {
      const obs = await E.AccessAcceptance.get(String(body.observation_id || '')).catch(missing);
      if (!obs || obs.kind !== 'Observation' || obs.test_user_id !== actor.user.id) return json({ error: 'Observation not found for this identity' }, 404);
      if (!ordinary(actor.user)) return json({ error: 'An ordinary non-editor identity is required' }, 403);
      if (obs.state !== 'Started') return json({ error: 'Completed evidence cannot be overwritten' }, 409);
      const expected = obs.probe_group === 'Admission retry' ? ['admission_retry', 'requirement_after_retry', 'audit_after_retry'] : probeNames.filter(p => !['admission_retry', 'requirement_after_retry', 'audit_after_retry'].includes(p));
      const results = body.results;
      if (!Array.isArray(results) || results.length !== expected.length || results.some((r,i) => !r || r.probe !== expected[i] || !['fulfilled', 'rejected', 'skipped'].includes(r.outcome) || (r.status !== null && (!Number.isInteger(r.status) || r.status < 100 || r.status > 599)) || JSON.stringify(r).length > 1000)) return json({ error: 'Expected bounded, ordered native-probe results' }, 400);
      const manifest = (await E.AccessAcceptance.filter({ kind: 'Fixture set', run_id: obs.run_id, test_user_id: actor.user.id }, { limit: 1 })).items[0];
      if (!manifest) return json({ error: 'Fixture set missing; observation retained' }, 409);
      const after = await snapshot(base44, actor.user, manifest);
      const before = JSON.parse(obs.before_json);
      const changed = obs.probe_group !== 'Admission retry' && (JSON.stringify(before.profile) !== JSON.stringify(after.profile) || JSON.stringify(before.roster) !== JSON.stringify(after.roster));
      const patch = { after_json: JSON.stringify(after), request_results_json: JSON.stringify(results), finished_at: new Date().toISOString(), state: 'Recorded, review pending', stop_required: changed, evidence_class: 'Server-observed identity and stored state; browser request outcomes are client-observed and require independent trace review. No automatic pass verdict.' };
      const saved = await E.AccessAcceptance.updateMany({ id: obs.id, state: 'Started' }, { $set: patch });
      if (saved.updated !== 1) return json({ error: 'Evidence already completed; not overwritten' }, 409);
      return json({ observation: publicEvidence({ ...obs, ...patch }), stop_required: changed, status: changed ? 'Unexpected stored profile/roster change: stop acceptance and quarantine the isolated subject before continuing.' : 'Observation retained. Review native request traces and expected visibility; no pass claimed.' });
    }
    const manifest = await E.AccessAcceptance.get(String(body.manifest_id || '')).catch(missing);
    if (!manifest || manifest.kind !== 'Fixture set' || (!admin && manifest.test_user_id !== actor.user.id)) return json({ error: 'Fixture set not found for this identity' }, 404);
    if (body.op === 'evidence') {
      const page = await E.AccessAcceptance.filter({ kind: 'Observation', run_id: manifest.run_id }, { sort: '-created_date', limit: 20, ...(body.cursor ? { cursor: body.cursor } : {}) });
      return json({ items: page.items.map(publicEvidence), has_more: page.has_more, next_cursor: page.next_cursor });
    }
    if (manifest.test_user_id !== actor.user.id || !ordinary(actor.user)) return json({ error: 'Only the assigned ordinary test identity can run the native probes' }, 403);
    const stage = body.stage;
    const group = body.probe_group || 'Native probes';
    if (!stages.includes(stage) || !['Native probes', 'Admission retry'].includes(group) || (group === 'Admission retry' && stage !== 'Deactivated')) return json({ error: 'Invalid acceptance stage/group' }, 400);
    if (await E.AccessAcceptance.count({ run_id: manifest.run_id, stop_required: true })) return json({ error: 'Unexpected stored change was recorded. Stop acceptance; IT must quarantine the subject and review evidence. No automatic reset.' }, 409);
    if (await E.AccessAcceptance.count({ kind: 'Observation', run_id: manifest.run_id }) >= 20) return json({ error: 'Bounded observation limit reached; preserve evidence for review' }, 409);
    const before = await snapshot(base44, actor.user, manifest);
    const roster = before.roster;
    if (group === 'Native probes' && ((stage === 'Not admitted' && roster.length !== 0) || (stage === 'Admitted read-only' && !(roster.length === 1 && actor.admitted && actor.role === 'Read-only' && !actor.canApprove)) || (stage === 'Deactivated' && !(roster.length === 1 && roster[0].active === false && !actor.admitted)))) return json({ error: 'Roster state does not match this stage. A roster Administrator makes test-only role transitions separately; this console grants nothing.' }, 409);
    const prerequisite = group === 'Admission retry' ? 'Deactivated' : stage === 'Deactivated' ? 'Admitted read-only' : stage === 'Admitted read-only' ? 'Not admitted' : null;
    if (prerequisite && !await E.AccessAcceptance.count({ kind: 'Observation', run_id: manifest.run_id, stage: prerequisite, probe_group: 'Native probes', state: 'Recorded, review pending' })) return json({ error: `Record ${prerequisite} native evidence first` }, 409);
    const auth = req.headers.get('authorization');
    const fingerprint = auth ? await sha256(auth) : '';
    const first = (await E.AccessAcceptance.filter({ kind: 'Observation', run_id: manifest.run_id }, { sort: 'created_date', limit: 1 })).items[0];
    const sameContext = !first ? 'First observation' : !fingerprint || !first.authentication_fingerprint ? 'Unavailable; same-open-session continuity needs external request traces' : fingerprint === first.authentication_fingerprint ? 'Same authenticated request credential fingerprint as first observation' : 'Credential changed; open-session revocation is not established by this observation';
    const observation = await E.AccessAcceptance.create({ kind: 'Observation', run_id: manifest.run_id, test_user_id: actor.user.id, test_user_email: actor.email, stage, probe_group: group, state: 'Started', started_at: new Date().toISOString(), authentication_fingerprint: fingerprint, identity_json: JSON.stringify({ ...identity(actor.user, actor), session_continuity: sameContext }), before_json: JSON.stringify(before), evidence_class: 'Started only; no requests or pass verdict yet' });
    return json({ observation_id: observation.id, stage, probe_group: group, session_continuity: sameContext, targets: { requirement_id: manifest.requirement_record_id, audit_id: manifest.audit_record_id, member_id: roster[0]?.id || null, user_id: actor.user.id } });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}