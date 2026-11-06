import { sha256 } from './compliance.ts';

const META = new Set(['id','created_date','updated_date','created_by_id','created_by','is_sample','approval_status','approved_by','approval_date','approval_lock','approval_id','approved_version_id','approved_snapshot_hash','approval_gate_version','status','designated_reviewer','decided_at']);
export function reviewedSnapshot(record) {
  return Object.fromEntries(Object.keys(record).filter(k => !META.has(k)).sort().map(k => [k, record[k]]));
}
export async function snapshotHash(record) { return sha256(JSON.stringify(reviewedSnapshot(record))); }
export async function approvalSource(base44, item) {
  if (item.is_fixture && item.acceptance_fixture) return { fixture: true };
  if (!item.source_url) return null;
  const E = base44.asServiceRole.entities;
  const exact = await E.Source.filter({ url: item.source_url, verification_status: 'Verified', is_fixture: { $ne: true }, jurisdiction_id: item.jurisdiction_id }, { limit: 2 });
  if (exact.items.length === 1) return exact.items[0];
  const docs = await E.DocumentRecord.filter({ document_url: item.source_url, is_fixture: { $ne: true } }, { sort: '-fetched_at', limit: 20 });
  if (!docs.items.length) return null;
  const publishers = await E.Source.filter({ source_id: { $in: docs.items.map(d => d.source_id) }, verification_status: 'Verified', jurisdiction_id: item.jurisdiction_id, is_fixture: { $ne: true } }, { limit: 20 });
  return publishers.items[0] || null;
}
export function exactKeys(body, allowed) { return Object.keys(body).filter(k => !allowed.includes(k)); }
export function confirmedAuthority(member, userId) {
  return member?.active === true && member?.can_approve === true && member.user_id === userId
    && Boolean(member.authority_confirmed_at) && Boolean(member.authority_confirmed_by_user_id)
    && member.authority_confirmed_by_user_id !== userId;
}
export async function claim(entity, record, patch, extra = {}) {
  const result = await entity.updateMany({ id: record.id, updated_date: record.updated_date, ...extra }, { $set: patch });
  return result.updated === 1;
}
export async function validRequirementApproval(base44, record) {
  if (record.is_fixture || record.quarantined || record.approval_status !== 'Approved' || record.approval_gate_version !== 2 || !record.approval_id || !record.approved_version_id) return false;
  const [a,v] = await Promise.all([
    base44.asServiceRole.entities.Approval.get(record.approval_id).catch(e => e.status === 404 ? null : Promise.reject(e)),
    base44.asServiceRole.entities.RequirementVersion.get(record.approved_version_id).catch(e => e.status === 404 ? null : Promise.reject(e)),
  ]);
  if (!a || !v || a.decision !== 'Approved' || a.item_id !== record.id || !a.audit_event_id || a.designated_reviewer !== a.decided_by || a.designated_reviewer_user_id === a.requested_by_user_id || (a.contributor_user_ids || []).includes(a.designated_reviewer_user_id)) return false;
  const audit = await base44.asServiceRole.entities.AuditEvent.get(a.audit_event_id).catch(e => e.status === 404 ? null : Promise.reject(e));
  return Boolean(audit && audit.recorded_by === 'decideApproval' && audit.entity_type === 'Requirement' && audit.entity_id === record.requirement_id && a.execution_state === 'Completed' && v.approval_id === a.id && v.snapshot_hash === a.snapshot_hash && record.approved_snapshot_hash === a.snapshot_hash && await snapshotHash(record) === a.snapshot_hash);
}