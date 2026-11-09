import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, shortText, json } from '../../shared/compliance.ts';
import { publisherFingerprint, canonicalUrl } from '../../shared/publicationTraversal.ts';
import { retrievePublication } from '../../shared/retrievePublication.ts';
import { FETCH_MAINTENANCE, directFetchConfig } from '../../shared/protectedFetch.ts';
import { inspectSource, allowedHostsFromSources } from '../../shared/inspectFetch.ts';

export default async function(req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.admitted) return json({ error: 'Your account is not admitted to this compliance workspace.' }, 403);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    if (body.op === 'list') {
      const query = { is_fixture: { $ne: true }, verification_status: 'Awaiting source verification' };
      if (body.search) query.$or = ['authority','jurisdiction_name','url'].map(k => ({ [k]: { $regex: String(body.search).slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
      const [page, total] = await Promise.all([base44.entities.Source.filter(query, { sort: 'jurisdiction_name', limit: 12, cursor: body.cursor || undefined }), base44.entities.Source.count(query)]);
      const urls = page.items.map(s => s.url);
      const others = urls.length ? await E.Source.filter({ url: { $in: urls }, is_fixture: { $ne: true } }, { limit: 200 }) : { items: [] };
      return json({ ...page, total, items: page.items.map(s => ({ ...s, conflicts: [others.items.filter(o => o.url === s.url).length > 1 ? 'Duplicate publication URL: review individually; no automatic merge.' : '', !s.territorial_scope ? 'Territorial scope not evidenced.' : '', s.review_attention || '', s.format_gap || ''].filter(Boolean) })) });
    }
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);
    if (body.op === 'propose') {
      if (!canonicalUrl(body.url) || !body.authority || !body.jurisdiction_id) return json({ error: 'Public publication URL, authority and jurisdiction are required.' }, 400);
      const js = await E.Jurisdiction.filter({ jurisdiction_id: String(body.jurisdiction_id) });
      if (js.length !== 1) return json({ error: 'Jurisdiction not found' }, 400);
      const source = await E.Source.create({ source_id: `SRC-${crypto.randomUUID()}`, url: canonicalUrl(body.url), authority: shortText(body.authority, 240), jurisdiction_id: js[0].jurisdiction_id, jurisdiction_name: js[0].name, source_type: body.source_type || 'Other official', language: body.language || 'Unknown', topics: String(body.topics || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 12), verification_status: 'Awaiting source verification', health_status: 'Awaiting source verification', check_frequency: 'Daily', discovered_by: actor.email });
      await logAudit(base44, actor, { event_type: 'Source proposed', entity_type: 'Source', entity_id: source.id, summary: `Source proposed by ${actor.email}; no verification recorded.`, recorded_by: 'sourceReview' });
      return json({ source });
    }
    if (body.op === 'configure') {
      const source = await E.Source.get(String(body.id || '')).catch(e => e.status === 404 ? null : Promise.reject(e));
      if (!source || source.is_fixture) return json({ error: 'Live source not found' }, 404);
      const patch = {};
      if (body.check_frequency !== undefined) {
        if (!['Daily','Weekly','Six-hourly','Manual'].includes(body.check_frequency)) return json({ error: 'Invalid frequency' }, 400);
        patch.check_frequency = body.check_frequency;
      }
      for (const [key, max] of [['pages_per_job',8],['crawl_budget',2000],['max_link_depth',8]]) if (body[key] !== undefined) patch[key] = Math.max(1, Math.min(max, Number(body[key]) || 1));
      if (!Object.keys(patch).length) return json({ error: 'No permitted configuration supplied' }, 400);
      await E.Source.update(source.id, patch);
      await logAudit(base44, actor, { event_type: 'Source collection configuration', entity_type: 'Source', entity_id: source.id, summary: `Collection settings changed: ${Object.keys(patch).join(', ')}. Verification retained; publisher and scope unchanged.`, recorded_by: 'sourceReview' });
      return json({ ok: true });
    }
    const ids = [...new Set(Array.isArray(body.source_ids) ? body.source_ids.map(String) : [])];
    if (!ids.length || ids.length > 12) return json({ error: 'Select between 1 and 12 sources.' }, 400);
    const sources = await E.Source.filter({ id: { $in: ids } });
    if (body.op === 'inspect') {
      if (ids.length > 2) return json({ error: 'Inspect at most two sources per request.' }, 400);
      // Retrieval stays paused unless the owner sets DIRECT_FETCH_ENABLED=true (and FETCH_CONTACT). Only this action
      // may use the bounded fetcher; every other caller keeps the paused behaviour.
      const fetchConfig = directFetchConfig();
      if (!fetchConfig.enabled) return json({ ...FETCH_MAINTENANCE }, 503);
      if (!fetchConfig.ready) return json({ ...FETCH_MAINTENANCE, code: 'DIRECT_FETCH_CONFIG_ERROR', message: 'Direct retrieval is misconfigured', reason: fetchConfig.problem }, 503);
      const allowedHosts = allowedHostsFromSources(await E.Source.filter({ is_fixture: { $ne: true } }, { limit: 20000 }));
      const results = [];
      for (const s of sources) {
        if (s.is_fixture) continue;
        try {
          const r = await inspectSource(E, s, { allowedHosts, config: fetchConfig });
          await logAudit(base44, actor, { event_type: 'Source sample retrieval', entity_type: 'Source', entity_id: s.id, entity_label: s.source_id, summary: r.attempted ? `Retrieve sample attempted once for ${s.source_id}: ${r.ok ? 'text retrieved' : r.gap}` : `Retrieve sample not attempted for ${s.source_id}: ${r.limitations}`, detail: r.content_hash || '', recorded_by: 'sourceReview' });
          results.push(r);
        } catch (error) { await E.Source.update(s.id, { review_attention: shortText(error.message, 500), format_gap: shortText(error.message, 500) }); results.push({ id: s.id, error: error.message }); }
      }
      return json({ results, note: 'Retrieval is not verification. No approval decision was made.' });
    }
    if (!['verify','reject'].includes(body.op)) return json({ error: 'Unknown source-review operation' }, 400);
    const rationale = String(body.evidence || body.reason || '').trim();
    if (rationale.length < 25 || rationale.length > 3000) return json({ error: 'Record a 25–3000 character reviewer rationale identifying provenance and coverage, not merely HTTP success.' }, 400);
    const done = []; const refused = [];
    for (const source of sources) {
      if (source.is_fixture || source.verification_status !== 'Awaiting source verification') { refused.push({ source_id: source.source_id, reason: 'Not a pending live candidate' }); continue; }
      const review = (body.reviews || []).find(r => r.id === source.id) || {};
      let patch = { verification_status: 'Rejected', health_status: 'Not configured' };
      if (body.op === 'verify') {
        const provenance = canonicalUrl(review.provenance_reference_url || source.provenance_reference_url);
        const sample = canonicalUrl(review.sample_document_url || source.sample_document_url);
        const scope = String(review.territorial_scope || source.territorial_scope || '').trim();
        const topics = source.subject_coverage?.length ? source.subject_coverage : source.topics || [];
        const duplicates = await E.Source.count({ url: source.url, is_fixture: { $ne: true } });
        if (!provenance || !sample || !scope || !topics.length || body.provenance_confirmed !== true || (duplicates > 1 && ids.length !== 1)) { refused.push({ source_id: source.source_id, reason: 'Official provenance reference, sample document, territorial scope, subjects and explicit human confirmation are required. Duplicates require individual review.' }); continue; }
        patch = { verification_status: 'Verified', health_status: 'Queued', next_check_at: new Date().toISOString(), provenance_reference_url: provenance, sample_document_url: sample, territorial_scope: scope, subject_coverage: topics, review_attention: '', publication_types: [source.source_type], verified_publisher_hash: await publisherFingerprint({ ...source, territorial_scope: scope, subject_coverage: topics, provenance_reference_url: provenance }) };
      }
      patch.verified_by = actor.email; patch.verified_at = new Date().toISOString();
      patch.verification_evidence = `${source.verification_evidence || ''}\nHuman source decision by ${actor.email}: ${rationale}. Source verification is not approval of legal interpretation.`;
      const result = await E.Source.updateMany({ id: source.id, updated_date: source.updated_date, verification_status: 'Awaiting source verification' }, { $set: patch });
      if (result.updated === 1) done.push(source.source_id); else refused.push({ source_id: source.source_id, reason: 'Source changed; reload evidence' });
    }
    await logAudit(base44, actor, { event_type: 'Source verification decision', entity_type: 'Source', entity_id: ids.join(','), summary: `${actor.email} recorded ${body.op} for ${done.length} sources; ${refused.length} refused.`, detail: JSON.stringify({ rationale, done, refused, reviews: body.reviews || [] }), evidence_class: 'Human source verification, not legal interpretation approval', recorded_by: 'sourceReview' });
    return json({ decided: done, refused });
  } catch (error) { return json({ error: error.message }, 500); }
}