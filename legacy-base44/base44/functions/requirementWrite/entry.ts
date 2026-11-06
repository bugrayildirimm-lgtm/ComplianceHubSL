import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, shortText, json } from '../../shared/compliance.ts';

const CONTENT = ['title', 'jurisdiction_id', 'jurisdiction_name', 'territorial_scope', 'category', 'product_type', 'regulated_party',
  'authority', 'instrument', 'article_reference', 'source_url', 'source_version', 'source_excerpt', 'language', 'obligation_type',
  'legal_status', 'publication_date', 'effective_date', 'future_effective_date', 'legal_entity_name', 'studio_name',
  'english_translation', 'translation_uncertainty', 'internal_interpretation', 'applicability_rationale',
  'operator_obligation', 'supplier_support_obligation', 'support_basis', 'responsible_team', 'owner', 'linked_alert_id'];
const ASSESSMENT = ['applicability_status', 'implementation_status', 'compliance_assessment', 'next_review_date'];
const FORBIDDEN = ['approval_status', 'approved_by', 'approval_date', 'current_version', 'approved_version_id', 'approved_snapshot_hash',
  'approval_id', 'approval_lock', 'approval_gate_version', 'quarantined', 'requirement_id', 'drafter_email', 'drafter_user_id'];

function pick(body, allowed) {
  const out = {};
  for (const key of allowed) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

// The only route by which a requirement is created or edited. Approval fields are
// never accepted here; the requirement always starts as an unreviewed candidate.
export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const body = await req.json().catch(() => ({}));
    const op = body.op;
    const supplied = Object.keys(body).filter((k) => FORBIDDEN.includes(k));
    if (supplied.length) return json({ error: `Approval and identity fields cannot be supplied by the client: ${supplied.join(', ')}.` }, 400);

    if (op === 'createCandidate') {
      const content = pick(body, CONTENT);
      if (!content.title || !content.category) return json({ error: 'title and category are required' }, 400);
      if (!CONTENT.includes('jurisdiction_id') || !body.jurisdiction_id) return json({ error: 'jurisdiction_id is required' }, 400);
      const requirementId = await nextRef(base44, 'Requirement', 'requirement_id', 'REQ', 5);
      const record = await base44.asServiceRole.entities.Requirement.create({
        ...content,
        requirement_id: requirementId,
        applicability_status: 'Under review',
        implementation_status: 'Unknown',
        approval_status: 'Candidate — unreviewed',
        current_version: 1,
        ai_generated: Boolean(body.ai_generated),
        is_fixture: Boolean(body.is_fixture),
        drafter_user_id: actor.user.id,
        drafter_email: actor.email,
        contributor_user_ids: [actor.user.id],
        approval_gate_version: 2,
      });
      await logAudit(base44, actor, {
        event_type: 'Requirement candidate created', entity_type: 'Requirement', entity_id: requirementId,
        entity_label: content.title, summary: `Candidate requirement ${requirementId} created for ${content.jurisdiction_name || body.jurisdiction_id}. Unreviewed; approval is separate.`,
        recorded_by: 'requirementWrite',
      });
      return json({ requirement: record });
    }

    if (op === 'saveAssessment' || op === 'saveDraft') {
      const record = await base44.asServiceRole.entities.Requirement.get(String(body.id || '')).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!record) return json({ error: 'Requirement not found' }, 404);
      if (record.is_fixture) return json({ error: 'Test fixtures cannot be assessed as company requirements.' }, 400);
      if (record.quarantined) return json({ error: 'This record is quarantined.' }, 400);
      if (record.approval_status === 'Approved' || record.approval_status === 'Superseded') {
        return json({ error: 'Approved text is immutable. Propose an amendment to change content or applicability.', code: 'IMMUTABLE' }, 409);
      }
      const patch = pick(body, op === 'saveDraft' ? [...CONTENT, ...ASSESSMENT] : ASSESSMENT);
      patch.contributor_user_ids = Array.from(new Set([...(record.contributor_user_ids || []), actor.user.id]));
      if (patch.source_url !== undefined && patch.source_url !== record.source_url) {
        patch.source_record_id = '';
        patch.source_verification_status = 'Awaiting source verification';
        patch.source_content_hash = '';
      }
      if (!Object.keys(patch).length) return json({ error: 'No assessment field supplied' }, 400);
      const applied = await base44.asServiceRole.entities.Requirement.updateMany({ id: record.id, updated_date: record.updated_date }, { $set: patch });
      if (applied.updated !== 1) return json({ error: 'The requirement changed while you were editing. Reload and try again.' }, 409);
      await logAudit(base44, actor, {
        event_type: 'Requirement assessment updated', entity_type: 'Requirement', entity_id: record.requirement_id,
        entity_label: record.title, summary: `Assessment updated: ${Object.keys(patch).join(', ')}.`, detail: patch.compliance_assessment || '',
        recorded_by: 'requirementWrite',
      });
      return json({ ok: true });
    }

    if (op === 'amend') {
      const source = await base44.asServiceRole.entities.Requirement.get(String(body.id || '')).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!source) return json({ error: 'Requirement not found' }, 404);
      if (source.approval_status !== 'Approved') return json({ error: 'Only an approved requirement needs an amendment; edit the candidate instead.' }, 409);
      const requirementId = await nextRef(base44, 'Requirement', 'requirement_id', 'REQ', 5);
      const content = pick(source, CONTENT);
      const record = await base44.asServiceRole.entities.Requirement.create({
        ...content,
        ...pick(body, CONTENT),
        requirement_id: requirementId,
        approval_status: 'Candidate — unreviewed',
        applicability_status: 'Under review',
        implementation_status: source.implementation_status || 'Unknown',
        current_version: (Number(source.current_version) || 1) + 1,
        supersedes_requirement_id: source.requirement_id,
        drafter_user_id: actor.user.id,
        drafter_email: actor.email,
        contributor_user_ids: [actor.user.id],
        approval_gate_version: 2,
        ai_generated: false,
      });
      await logAudit(base44, actor, {
        event_type: 'Requirement amendment proposed', entity_type: 'Requirement', entity_id: requirementId,
        entity_label: source.title, summary: `Amendment ${requirementId} proposed to supersede ${source.requirement_id}. The approved version and its approval are retained unchanged.`,
        recorded_by: 'requirementWrite',
      });
      return json({ requirement: record });
    }

    if (op === 'sendForReview') {
      if (!body.jurisdiction_id || !body.category) return json({ error: 'jurisdiction_id and category are required' }, 400);
      const drafts = await base44.asServiceRole.entities.Requirement.filter({
        jurisdiction_id: body.jurisdiction_id, category: body.category, approval_status: 'Candidate — unreviewed', is_fixture: { $ne: true },
      });
      if (!drafts.length) return json({ error: 'No unreviewed candidate exists for this cell.' }, 400);
      await base44.asServiceRole.entities.Requirement.updateMany(
        { jurisdiction_id: body.jurisdiction_id, category: body.category, approval_status: 'Candidate — unreviewed' },
        { $set: { approval_status: 'In review' } },
      );
      await base44.asServiceRole.entities.RequirementBaseline.updateMany(
        { jurisdiction_id: body.jurisdiction_id, category: body.category },
        { $set: { status: 'Awaiting review' } },
      );
      await logAudit(base44, actor, {
        event_type: 'Baseline drafts sent for review', entity_type: 'Requirement', entity_id: `${body.jurisdiction_id}|${body.category}`,
        entity_label: `${body.jurisdiction_name || body.jurisdiction_id} — ${body.category}`,
        summary: `${drafts.length} candidate requirement(s) moved to review. No approval was recorded.`,
        recorded_by: 'requirementWrite',
      });
      return json({ moved: drafts.length });
    }

    return json({ error: 'Unsupported operation' }, 400);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}