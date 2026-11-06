import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, shortText, json } from '../../shared/compliance.ts';
import { snapshotHash, reviewedSnapshot, exactKeys, approvalSource } from '../../shared/approvalIntegrity.ts';

const ALLOWED = ['item_type', 'item_id', 'summary', 'designated_reviewer_email'];
const GATE = 2;

// Creates the reviewable snapshot. Drafter, reviewer identity and timestamps are
// derived from the trusted server session, never from the request body.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role cannot submit items for approval' }, 403);

    const body = await req.json().catch(() => ({}));
    const rejected = exactKeys(body, ALLOWED);
    if (rejected.length) return json({ error: `Fields not accepted: ${rejected.join(', ')}. Drafter, reviewer and timestamps are derived server-side.` }, 400);
    const { item_type: itemType, item_id: itemId } = body;
    if (!itemType || !itemId) return json({ error: 'item_type and item_id are required' }, 400);

    let item = null;
    if (itemType === 'Requirement' || itemType === 'Requirement amendment') {
      item = await base44.asServiceRole.entities.Requirement.get(itemId).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!item) return json({ error: 'Requirement not found' }, 404);
      if (item.is_fixture && !(item.acceptance_fixture === true && String(item.requirement_id).startsWith('TEST-ACCEPTANCE-'))) return json({ error: 'Only the isolated labelled acceptance fixture may exercise approval. Other fixtures remain blocked.' }, 400);
      if (item.quarantined) return json({ error: 'This record is quarantined and cannot be approved.' }, 400);
      if (!await approvalSource(base44, item)) return json({ error: 'This exact source or its collected underlying document must be linked to a human-verified publisher in the relevant jurisdiction before approval. Provisional research elsewhere continues.' }, 409);
      if (!['Candidate — unreviewed', 'In review'].includes(item.approval_status)) {
        return json({ error: `A requirement with status "${item.approval_status}" cannot be submitted. Approved text is immutable: propose an amendment instead.` }, 409);
      }
      const missing = [];
      if (!item.source_url) missing.push('official source URL');
      if (!item.source_excerpt) missing.push('supporting source excerpt');
      if (!item.applicability_rationale) missing.push('applicability rationale');
      if (!item.article_reference) missing.push('article or paragraph reference');
      if (missing.length) return json({ error: `Approval requires reviewed source evidence and applicability. Missing: ${missing.join(', ')}.` }, 400);
    } else if (itemType === 'Market permission decision') {
      item = await base44.asServiceRole.entities.MarketPermissionDecision.get(itemId).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!item) return json({ error: 'Market permission decision not found' }, 404);
      if (!['Draft', 'Pending approval'].includes(item.status)) {
        return json({ error: `A decided market permission cannot be resubmitted (status "${item.status}").` }, 409);
      }
      if (!item.rationale) return json({ error: 'A market-permission decision needs a recorded rationale before approval.' }, 400);
    } else {
      return json({ error: 'Unsupported item type for approval' }, 400);
    }

    // Eligible reviewers: active, confirmed approvers who are not this drafter
    // and did not contribute to the content.
    const members = (await base44.asServiceRole.entities.TeamMember.list({ limit: 200 })).items || [];
    const eligible = members.filter((m) => m.active === true && m.can_approve === true && m.user_id
      && m.authority_confirmed_at && m.authority_confirmed_by_user_id && m.authority_confirmed_by_user_id !== m.user_id
      && m.user_id !== actor.user.id && m.user_id !== item.drafter_user_id
      && !(item.contributor_user_ids || []).includes(m.user_id));
    let reviewer = null;
    if (body.designated_reviewer_email) {
      const wanted = String(body.designated_reviewer_email).toLowerCase();
      reviewer = eligible.find((m) => String(m.user_email).toLowerCase() === wanted) || null;
      if (!reviewer) return json({ error: 'The named reviewer is not an active approver with confirmed authority, or is the drafter.' }, 400);
    } else {
      return json({ error: 'Choose a different named reviewer explicitly. Reviewers are never automatically assigned.' }, 400);
    }
    if (!reviewer) {
      return json({
        code: 'NO_SECOND_REVIEWER',
        error: 'No second person holds confirmed approval authority, so no approval can be raised. Self-approval is blocked by design; an authorised colleague must be appointed and confirmed first.',
      }, 409);
    }

    const hash = await snapshotHash(item);
    const versionNumber = Number(item.current_version) || 1;
    const token = crypto.randomUUID();

    const approval = await base44.asServiceRole.entities.Approval.create({
      approval_ref: await nextRef(base44, 'Approval', 'approval_ref', 'APR', 4),
      item_type: itemType,
      item_id: itemId,
      item_title: item.title || item.decision_ref || 'Untitled item',
      summary: shortText(body.summary || item.title || '', 800),
      requested_by: actor.email,
      requested_by_user_id: actor.user.id,
      drafter: actor.email,
      drafter_user_id: actor.user.id,
      contributor_user_ids: Array.from(new Set([actor.user.id, ...(item.contributor_user_ids || [])])),
      designated_reviewer: reviewer.user_email,
      designated_reviewer_user_id: reviewer.user_id,
      decision: 'Pending',
      evidence_checked: true,
      snapshot_json: JSON.stringify(reviewedSnapshot(item)),
      snapshot_hash: hash,
      version_number: versionNumber,
      item_lock: token,
      execution_state: 'Awaiting decision',
      effective_date: item.future_effective_date || item.effective_date || '',
      approval_gate_version: GATE,
    });

    const target = base44.asServiceRole.entities[itemType === 'Market permission decision' ? 'MarketPermissionDecision' : 'Requirement'];
    const lockPatch = itemType === 'Market permission decision'
      ? { status: 'Pending approval', approval_lock: token, approval_id: approval.id, approval_gate_version: GATE }
      : { approval_status: 'In review', approval_lock: token, approval_id: approval.id, approval_gate_version: GATE };
    const locked = await target.updateMany({ id: itemId, updated_date: item.updated_date }, { $set: lockPatch });
    if (locked.updated !== 1) {
      await base44.asServiceRole.entities.Approval.update(approval.id, { execution_state: 'Invalidated — content changed', decision: 'Returned for changes' });
      return json({ error: 'The item changed while its snapshot was being prepared. Reload and resubmit.' }, 409);
    }

    const audit = await logAudit(base44, actor, {
      event_type: 'Approval requested',
      entity_type: 'Approval',
      entity_id: approval.id,
      entity_label: approval.approval_ref,
      summary: `Approval requested for ${itemType.toLowerCase()} "${approval.item_title}". Snapshot ${hash.slice(0, 12)} bound to version ${versionNumber}; designated reviewer ${reviewer.user_email}.`,
      evidence_class: 'Server-recorded request; the decision itself requires a human approver',
      recorded_by: 'submitApproval',
    });
    await base44.asServiceRole.entities.Approval.update(approval.id, { audit_event_id: undefined });

    return json({ approval, reviewer: reviewer.user_email, snapshot_hash: hash, request_audit_id: audit.id });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}