import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, shortText, json } from '../../shared/compliance.ts';
import { snapshotHash, exactKeys, approvalSource } from '../../shared/approvalIntegrity.ts';

const ALLOWED = ['approval_id', 'decision', 'reason', 'effective_date'];

// Server-side decision gate. The decision, reviewer, snapshot binding and audit
// evidence are written together by the server; replay is blocked by claiming the
// approval row with a conditional update before any record changes.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canApprove) {
      return json({ error: 'Your access role does not carry confirmed compliance-approval authority.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const rejected = exactKeys(body, ALLOWED);
    if (rejected.length) return json({ error: `Fields not accepted: ${rejected.join(', ')}. reviewer, version and timestamps are server-derived.` }, 400);
    const { approval_id: approvalId, decision, reason } = body;
    if (!approvalId || !decision) return json({ error: 'approval_id and decision are required' }, 400);
    if (!['Approved', 'Rejected', 'Returned for changes'].includes(decision)) {
      return json({ error: 'decision must be Approved, Rejected or Returned for changes' }, 400);
    }
    if (!reason || reason.trim().length < 10) return json({ error: 'Record a decision reason (at least 10 characters).' }, 400);

    const approval = await base44.asServiceRole.entities.Approval.get(approvalId).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!approval) return json({ error: 'Approval not found' }, 404);
    if (approval.decision !== 'Pending') return json({ error: 'This approval has already been decided.' }, 409);
    if (approval.execution_state !== 'Awaiting decision') return json({ error: `This approval is in state "${approval.execution_state}" and cannot be decided again.` }, 409);
    if (!approval.designated_reviewer_user_id) return json({ error: 'This approval has no designated reviewer and cannot be decided.' }, 409);
    if (approval.designated_reviewer_user_id !== actor.user.id) {
      return json({ error: `Only the designated reviewer (${approval.designated_reviewer}) may decide this item.` }, 403);
    }
    const selfCheck = [approval.requested_by_user_id, approval.drafter_user_id, ...(approval.contributor_user_ids || [])];
    if (selfCheck.includes(actor.user.id)) {
      return json({ error: 'You drafted or contributed to this item. A different designated reviewer must decide it.' }, 403);
    }

    // ---- bind the decision to the exact reviewed snapshot ----
    let item = null;
    const isRequirement = approval.item_type === 'Requirement' || approval.item_type === 'Requirement amendment';
    if (isRequirement) {
      item = await base44.asServiceRole.entities.Requirement.get(approval.item_id).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    } else if (approval.item_type === 'Market permission decision') {
      item = await base44.asServiceRole.entities.MarketPermissionDecision.get(approval.item_id).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    } else {
      return json({ error: 'Unsupported item type for approval decision' }, 400);
    }
    if (!item) return json({ error: 'Linked item not found; the decision was not recorded.' }, 404);

    if (decision === 'Approved' && isRequirement && !await approvalSource(base44, item)) return json({ error: 'Source verification is no longer valid for this exact evidence reference. The decision was not applied.' }, 409);
    const currentHash = await snapshotHash(item);
    if (currentHash !== approval.snapshot_hash) {
      return json({
        error: 'The item changed after it was submitted for review. This approval cannot be applied to different content; submit the current text for review again.',
        code: 'SNAPSHOT_CHANGED',
      }, 409);
    }

    const reviewedEffectiveDate = item.future_effective_date || item.effective_date || '';
    if (body.effective_date && body.effective_date !== reviewedEffectiveDate) {
      return json({ error: 'Dates are part of the reviewed version. Edit the draft date and submit a new snapshot before deciding.', code: 'SNAPSHOT_DATE_CHANGE' }, 409);
    }
    const decidedAt = new Date().toISOString();
    const token = crypto.randomUUID();
    const claim = await base44.asServiceRole.entities.Approval.updateMany(
      { id: approval.id, decision: 'Pending', execution_state: 'Awaiting decision' },
      { $set: { execution_state: 'Executing', operation_token: token, decided_by: actor.email, decided_at: decidedAt } },
    );
    if (claim.updated !== 1) return json({ error: 'This approval was decided concurrently. Nothing further was changed.' }, 409);

    const failClaim = async (state) => {
      await base44.asServiceRole.entities.Approval.updateMany({ id: approval.id, operation_token: token }, { $set: { execution_state: state } });
    };

    let outcome = '';
    let version = null;
    let audit = null;

    if (isRequirement) {
      const effectiveDate = body.effective_date || item.future_effective_date || item.effective_date || '';
      if (decision === 'Approved') {
        const versionNumber = Number(approval.version_number) || Number(item.current_version) || 1;
        const existing = await base44.asServiceRole.entities.RequirementVersion.filter({ requirement_id: item.requirement_id, version_number: versionNumber });
        if (existing.length) {
          await failClaim('Failed — version already exists');
          return json({ error: `Version ${versionNumber} already exists for ${item.requirement_id}.`, code: 'VERSION_CONFLICT' }, 409);
        }
        version = await base44.asServiceRole.entities.RequirementVersion.create({
          requirement_id: item.requirement_id,
          requirement_record_id: item.id,
          version_number: versionNumber,
          snapshot_json: approval.snapshot_json || JSON.stringify(item),
          snapshot_hash: approval.snapshot_hash,
          change_summary: approval.summary || 'Approved version',
          changed_by: approval.drafter || '',
          approval_status: 'Approved',
          approved_by: actor.email,
          approval_date: decidedAt,
          effective_date: effectiveDate,
          created_via: 'decideApproval',
          approval_id: approval.id,
        });
        audit = await logAudit(base44, actor, {
          event_type: 'Approval decision',
          entity_type: 'Requirement',
          entity_id: item.requirement_id,
          entity_label: item.title,
          summary: `Requirement ${item.requirement_id} approved as version ${versionNumber} by ${actor.email} (designated reviewer).`,
          detail: `Snapshot ${String(approval.snapshot_hash).slice(0, 12)} bound to approval ${approval.approval_ref}. Reason: ${reason}`,
          evidence_class: 'Human decision recorded by a designated approver',
          recorded_by: 'decideApproval',
        });
        const applied = await base44.asServiceRole.entities.Requirement.updateMany(
          { id: item.id, updated_date: item.updated_date, approval_status: 'In review' },
          {
            $set: {
              approval_status: 'Approved', approved_by: actor.email, approval_date: decidedAt,
              current_version: versionNumber,
              approved_version_id: version.id, approved_snapshot_hash: approval.snapshot_hash,
              approval_id: approval.id, approval_lock: `Approved — version ${versionNumber} (${approval.approval_ref})`,
              approval_gate_version: 2,
            },
          },
        );
        if (applied.updated !== 1) {
          await failClaim('Failed — record changed before approval applied');
          return json({ error: 'The requirement changed between review and approval. The decision was not applied; the retained snapshot and audit entry document the attempt.', code: 'APPLY_FAILED' }, 409);
        }
        if (item.supersedes_requirement_id) {
          const prior = await base44.asServiceRole.entities.Requirement.filter({ requirement_id: item.supersedes_requirement_id });
          if (prior.length) {
            await base44.asServiceRole.entities.Requirement.updateMany({ id: prior[0].id }, { $set: { approval_status: 'Superseded' } });
          }
        }
        outcome = `Requirement ${item.requirement_id} approved as version ${versionNumber}; prior version retained.`;
      } else {
        audit = await logAudit(base44, actor, {
          event_type: 'Approval decision',
          entity_type: 'Requirement',
          entity_id: item.requirement_id,
          entity_label: item.title,
          summary: `${actor.email} recorded ${decision} on ${item.requirement_id}.`,
          detail: reason,
          evidence_class: 'Human decision recorded by a designated approver',
          recorded_by: 'decideApproval',
        });
        const applied = await base44.asServiceRole.entities.Requirement.updateMany(
          { id: item.id, updated_date: item.updated_date },
          { $set: { approval_status: decision === 'Rejected' ? 'Rejected' : 'In review', approval_lock: '' } },
        );
        if (applied.updated !== 1) {
          await failClaim('Failed — record changed before decision applied');
          return json({ error: 'The requirement changed during the decision; the status was not applied.', code: 'APPLY_FAILED' }, 409);
        }
        outcome = `Requirement ${item.requirement_id} ${decision.toLowerCase()}.`;
      }
    } else {
      if (decision === 'Approved') {
        audit = await logAudit(base44, actor, {
          event_type: 'Approval decision',
          entity_type: 'MarketPermissionDecision',
          entity_id: item.decision_ref || item.id,
          entity_label: item.jurisdiction_name,
          summary: `Market permission decision ${item.decision_ref} approved by designated reviewer ${actor.email}.`,
          detail: reason,
          evidence_class: 'Human decision recorded by a designated approver',
          recorded_by: 'decideApproval',
        });
        const applied = await base44.asServiceRole.entities.MarketPermissionDecision.updateMany(
          { id: item.id, status: 'Pending approval' },
          { $set: { status: 'Approved', designated_reviewer: actor.email, decided_at: decidedAt, effective_date: body.effective_date || item.effective_date || '', approval_lock: `Approved — ${approval.approval_ref}`, approval_id: approval.id, approved_snapshot_hash: approval.snapshot_hash, approval_gate_version: 2 } },
        );
        if (applied.updated !== 1) {
          await failClaim('Failed — record changed before approval applied');
          return json({ error: 'The decision record changed during approval.', code: 'APPLY_FAILED' }, 409);
        }
        outcome = `Market permission decision ${item.decision_ref} approved by ${actor.email}.`;
      } else {
        audit = await logAudit(base44, actor, {
          event_type: 'Approval decision',
          entity_type: 'MarketPermissionDecision',
          entity_id: item.decision_ref || item.id,
          entity_label: item.jurisdiction_name,
          summary: `${actor.email} recorded ${decision} on ${item.decision_ref}.`,
          detail: reason,
          evidence_class: 'Human decision recorded by a designated approver',
          recorded_by: 'decideApproval',
        });
        await base44.asServiceRole.entities.MarketPermissionDecision.updateMany(
          { id: item.id, status: 'Pending approval' },
          { $set: { status: decision === 'Rejected' ? 'Superseded' : 'Draft', designated_reviewer: actor.email, approval_lock: '' } },
        );
        outcome = `Market permission decision ${item.decision_ref} ${decision.toLowerCase()}.`;
      }
    }

    await base44.asServiceRole.entities.Approval.updateMany(
      { id: approval.id, operation_token: token },
      { $set: { decision, decision_reason: shortText(reason, 2000), decided_by: actor.email, decided_at: decidedAt, effective_date: body.effective_date || '', execution_state: 'Completed', version_id: version?.id || '', audit_event_id: audit?.id || '' } },
    );

    await base44.asServiceRole.entities.Notification.create({
      title: `${decision}: ${approval.item_title}`,
      body: shortText(`${actor.name} recorded "${decision}". ${reason}`, 400),
      severity: decision === 'Approved' ? 'Informational' : 'Urgent',
      link_path: '/approvals',
      read: false,
      delivery_channel: 'In-app',
      delivery_status: 'Delivered in-app',
    });

    return json({ ok: true, decision, outcome });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}