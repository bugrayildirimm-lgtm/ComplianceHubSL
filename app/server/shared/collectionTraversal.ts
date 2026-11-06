import { canonicalUrl, publisherFingerprint } from './publicationTraversal.ts';
import { retrievePublication } from './retrievePublication.ts';

async function enqueue(E, source, cycle, links, parent = '', depth = 0) {
  const inputUrls = new Set();
  const linkItems = links.filter(link => {
    const url = canonicalUrl(link.url);
    if (!url || inputUrls.has(url)) return false;
    inputUrls.add(url); return true;
  });
  const chunks = linkItems.reduce((all, item, i) => {
    if (i % 100 === 0) all.push([]);
    all[all.length - 1].push(item); return all;
  }, []);
  for (const batch of chunks) {
    const existing = await E.CrawlLink.filter({ source_id: source.source_id, cycle_id: cycle, url: { $in: batch.map(l => canonicalUrl(l.url)) } }, { limit: 100 });
    const seen = new Set(existing.items.map(l => l.url));
    const fresh = batch.filter(l => !seen.has(canonicalUrl(l.url))).map(l => ({ source_id: source.source_id, cycle_id: cycle, url: canonicalUrl(l.url), parent_url: parent, depth, label: l.label || '', kind: l.kind || 'Publication', status: 'Pending', attempts: 0, is_fixture: Boolean(source.is_fixture) }));
    if (fresh.length) await E.CrawlLink.bulkCreate(fresh);
  }
}
export async function collectTraversal(base44, source, onPublication, retrieve = retrievePublication) {
  const E = base44.asServiceRole.entities;
  if (source.verified_publisher_hash && await publisherFingerprint(source) !== source.verified_publisher_hash) {
    await E.Source.update(source.id, { verification_status: 'Awaiting source verification', health_status: 'Awaiting source verification', review_attention: 'Material publisher, provenance or scope configuration changed. Re-review required.' });
    throw new Error('Material source configuration changed. Re-review required, not routine re-approval.');
  }
  if (source.crawl_lease_until && Date.parse(source.crawl_lease_until) > Date.now()) return { skipped: true };
  const token = crypto.randomUUID();
  const lease = await E.Source.updateMany({ id: source.id, updated_date: source.updated_date, verification_status: 'Verified' }, { $set: { crawl_lease_token: token, crawl_lease_until: new Date(Date.now() + 280000).toISOString() } });
  if (lease.updated !== 1) return { skipped: true };
  const cycle = source.crawl_active && source.crawl_cycle_id ? source.crawl_cycle_id : crypto.randomUUID();
  const resumed = cycle === source.crawl_cycle_id && source.crawl_active;
  const mode = resumed ? source.crawl_mode : source.historical_finished_at ? 'Recurring' : 'Historical';
  let knownCursor = resumed ? source.crawl_known_cursor || '' : '';
  let knownSeeded = resumed ? source.crawl_known_seeded : false;
  const scope = source.crawl_scope || 'Relevant publication links and attachments on configured publisher hosts, up to the configured link depth; not the entire regulator website.';
  await E.Source.update(source.id, { crawl_cycle_id: cycle, crawl_active: true, crawl_mode: mode, crawl_scope: scope, health_status: 'Running', last_attempt_at: new Date().toISOString() });
  try {
    if (!resumed) await enqueue(E, source, cycle, [{ url: source.url, kind: 'Listing' }]);
    if (mode === 'Recurring' && !knownSeeded) {
      const page = await E.DocumentRecord.filter({ source_id: source.source_id, is_fixture: source.is_fixture ? true : { $ne: true } }, { sort: 'document_url', limit: 100, cursor: knownCursor || undefined });
      await enqueue(E, source, cycle, page.items.map(d => ({ url: d.document_url, label: d.title, kind: 'Publication' })));
      knownCursor = page.next_cursor || ''; knownSeeded = !page.has_more;
    } else if (mode === 'Historical') knownSeeded = true;
    const processedBefore = await E.CrawlLink.count({ source_id: source.source_id, cycle_id: cycle, status: { $in: ['Processed','Blocked'] } });
    const totalBudget = Math.max(1, Math.min(2000, Number(source.crawl_budget) || 500));
    const jobBudget = Math.min(8, Math.max(1, Number(source.pages_per_job) || 5));
    const maxDepth = Math.min(8, Math.max(1, Number(source.max_link_depth) || 4));
    let fetched = 0; let depthLimited = false; let cappedLinks = false; let firstHash = ''; let http = 0;
    const failures = [];
    while (fetched < jobBudget && processedBefore + fetched < totalBudget) {
      const listings = await E.CrawlLink.filter({ source_id: source.source_id, cycle_id: cycle, status: 'Pending', kind: 'Listing' }, { sort: 'created_date', limit: 1 });
      const page = listings.items.length ? listings : await E.CrawlLink.filter({ source_id: source.source_id, cycle_id: cycle, status: 'Pending' }, { sort: 'created_date', limit: 1 });
      const node = page.items[0]; if (!node) break;
      try {
        const p = await retrieve(base44, node.url, source, fetched === 0);
        // Leave a PDF queued when the job's one extraction allowance is used.
        // It becomes the first item on the next job, rather than a false failed extraction.
        if (p.pdf && !p.text && fetched > 0) break;
        if (!firstHash) firstHash = p.hash; http = p.status;
        const links = p.links || [];
        if (links.length > 300) cappedLinks = true;
        if (node.depth < maxDepth) await enqueue(E, source, cycle, links.slice(0, 300), node.url, node.depth + 1);
        else if (links.length) depthLimited = true;
        const documentId = await onPublication({ url: node.url, title: node.label || p.title, text: p.text, hash: p.hash, extractionStatus: p.extraction, extractionNote: p.note, ocrUsed: false, uncertainty: p.uncertainty, pdf: p.pdf, size: p.size }, mode);
        await E.CrawlLink.update(node.id, { status: p.extraction === 'Failed' ? 'Blocked' : 'Processed', attempts: (node.attempts || 0) + 1, document_id: documentId || '', detail: p.note || '' });
        if (p.extraction !== 'Complete' || p.uncertainty) failures.push(`${node.url}: ${p.note}`);
      } catch (error) {
        const detail = String(error.message).slice(0, 800);
        await E.CrawlLink.update(node.id, { status: 'Blocked', attempts: (node.attempts || 0) + 1, detail });
        failures.push(`${node.url}: ${detail}`);
      }
      fetched++;
    }
    const [pending, blocked] = await Promise.all([E.CrawlLink.count({ source_id: source.source_id, cycle_id: cycle, status: 'Pending' }), E.CrawlLink.count({ source_id: source.source_id, cycle_id: cycle, status: 'Blocked' })]);
    const capped = processedBefore + fetched >= totalBudget && pending > 0;
    const remaining = pending > 0 || !knownSeeded;
    const previousBoundary = resumed && /depth|link safety/i.test(source.crawl_stop_reason || '');
    const partial = remaining || blocked > 0 || failures.length > 0 || depthLimited || cappedLinks || previousBoundary;
    const stop = capped ? 'Cycle crawl budget reached; coverage partial. Increase the source budget to resume the saved frontier.' : remaining ? 'Per-job budget reached; saved frontier resumes automatically.' : depthLimited || previousBoundary ? 'Configured link-depth boundary reached; coverage is partial beyond that boundary.' : cappedLinks ? 'Per-page link safety cap reached; review traversal scope.' : blocked ? 'Frontier exhausted with source-specific retrieval/extraction gaps.' : 'Frontier exhausted within configured scope; no whole-jurisdiction completeness assertion.';
    const patch = { crawl_active: remaining, crawl_pending: pending, crawl_processed: processedBefore + fetched, crawl_known_cursor: knownCursor, crawl_known_seeded: knownSeeded, crawl_stop_reason: stop, format_gap: failures.slice(0, 3).join(' | ') || (blocked ? source.format_gap || 'Blocked links remain in the retained frontier.' : source.format_gap || '') };
    if (!remaining && mode === 'Historical') { patch.historical_finished_at = new Date().toISOString(); if (!partial) patch.historical_completed_at = patch.historical_finished_at; }
    await E.Source.update(source.id, patch);
    return { mode, cycle, partial, continue: remaining && !capped, stop, pending, fetched, http_status: http, page_hash: firstHash, failures, candidates: fetched };
  } finally {
    await E.Source.updateMany({ id: source.id, crawl_lease_token: token }, { $set: { crawl_lease_until: '', crawl_lease_token: '' } });
  }
}