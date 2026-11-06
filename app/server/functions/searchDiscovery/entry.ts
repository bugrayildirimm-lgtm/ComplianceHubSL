import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, json, shortText } from '../../shared/compliance.ts';
import { reserveUsage } from '../../shared/usageBudget.ts';

// Search-based discovery using Base44's native InvokeLLM web search.
// Scope: one bounded call per invocation, leads recorded in the discovery ledger only.
// Nothing here retrieves a document, measures change, verifies a publisher or approves anything.
// The model's URLs, titles, dates and snippets are model-written text, not retrieved evidence.
const MAX_ITEMS = 8;
const LABEL = 'Search-based discovery';

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string', description: 'URL exactly as it appeared in the search result; empty string if none was visible' },
          publication_date: { type: 'string', description: 'YYYY-MM-DD only if the result states it; otherwise empty string' },
          snippet: { type: 'string', description: 'Text copied from the search result, not paraphrased' },
          is_primary_official_source: { type: 'boolean' },
        },
        required: ['title', 'url', 'publication_date', 'snippet', 'is_primary_official_source'],
      },
    },
    query_used: { type: 'string' },
    results_visible: { type: 'number' },
  },
  required: ['items', 'query_used', 'results_visible'],
};

export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const body = await req.json().catch(() => ({}));
    const jurisdictionId = String(body.jurisdiction_id || '').slice(0, 80);
    if (!jurisdictionId) return json({ error: 'jurisdiction_id is required' }, 400);

    const jPage = await base44.asServiceRole.entities.Jurisdiction.filter({ jurisdiction_id: jurisdictionId }, { limit: 1 });
    const jurisdiction = (jPage.items || [])[0];
    if (!jurisdiction) return json({ error: 'Unknown jurisdiction' }, 404);

    const sourcePage = await base44.asServiceRole.entities.Source.filter(
      { jurisdiction_id: jurisdictionId, verification_status: 'Verified' },
      { limit: 5 }
    );
    const verified = (sourcePage.items || []).filter((s) => !s.is_fixture);
    let siteFromSource = '';
    try {
      siteFromSource = verified[0]?.url ? new URL(verified[0].url).hostname : '';
    } catch (_e) {
      siteFromSource = '';
    }
    const authority = shortText(body.authority || verified[0]?.authority || jurisdiction.name, 120);
    const site = shortText(body.site || siteFromSource, 120);
    const topic = shortText(body.topic || 'gambling regulation and technical requirements', 200);

    const runRef = `RUN-${crypto.randomUUID()}`;
    const startedAt = new Date().toISOString();

    const reservation = await reserveUsage(base44);
    if (!reservation.ok) {
      await base44.asServiceRole.entities.DiscoveryRun.create({
        run_ref: runRef, run_kind: 'Source discovery', trigger_type: 'Manual',
        status: 'Blocked — budget or usage limit', batch_limit: MAX_ITEMS, processed: 0,
        started_at: startedAt, finished_at: new Date().toISOString(),
        notes: `${LABEL} skipped: ${reservation.reason}. No search was performed.`,
      });
      return json({ run_ref: runRef, skipped: true, reason: reservation.reason, label: LABEL }, 200);
    }

    const prompt = [
      'You are assisting a gambling-supplier compliance team with SEARCH-BASED DISCOVERY only.',
      `Search the web for official publications from ${authority}${site ? ` (${site})` : ''} about ${topic}.`,
      'Report only what is visible in search results. Do not invent titles, URLs, dates or quotations.',
      'If a date is not visible in a result, return an empty string for it.',
      'Set is_primary_official_source true only when the result is on the publishing authority\'s own domain.',
    ].join('\n');

    let answer = null;
    let callError = '';
    try {
      answer = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        model: 'automatic',
        response_json_schema: SCHEMA,
      });
    } catch (error) {
      callError = shortText(error?.message || 'Native search call failed', 400);
    }

    const items = Array.isArray(answer?.items) ? answer.items.slice(0, MAX_ITEMS) : [];
    const clean = items.map((item) => ({
      title: shortText(item?.title || '', 240),
      url: String(item?.url || '').trim().slice(0, 1000),
      publication_date: shortText(item?.publication_date || '', 40),
      snippet: shortText(item?.snippet || '', 800),
      is_primary_official_source: item?.is_primary_official_source === true,
    }));
    const withUrl = clean.filter((i) => /^https?:\/\//i.test(i.url));
    const withoutUrl = clean.length - withUrl.length;
    const urls = Array.from(new Set(withUrl.map((i) => i.url)));

    let existingAttempts = [];
    let existingSources = [];
    if (urls.length) {
      const [attemptPage, sourcePage2] = await Promise.all([
        base44.asServiceRole.entities.DiscoveryAttempt.filter({ url: { $in: urls } }, { limit: 50 }),
        base44.asServiceRole.entities.Source.filter({ url: { $in: urls } }, { limit: 50 }),
      ]);
      existingAttempts = attemptPage.items || [];
      existingSources = sourcePage2.items || [];
    }
    const knownUrls = new Set([...existingAttempts.map((a) => a.url), ...existingSources.map((s) => s.url)]);

    const attemptedAt = new Date().toISOString();
    const toCreate = [];
    const leads = [];
    let duplicates = 0;
    for (const item of withUrl) {
      if (knownUrls.has(item.url)) {
        duplicates += 1;
        const registered = existingSources.some((s) => s.url === item.url);
        leads.push({ ...item, recorded: false, duplicate_note: registered ? 'Already a registered source; not duplicated.' : 'Already in the discovery ledger; not duplicated.' });
        continue;
      }
      knownUrls.add(item.url);
      toCreate.push({
        run_ref: runRef,
        jurisdiction_id: jurisdictionId,
        jurisdiction_name: jurisdiction.name,
        origin: 'Search-based discovery (unverified lead)',
        url: item.url,
        outcome: 'Search-based discovery — lead only',
        outcome_class: 'Search-based discovery — unverified lead',
        detail: [
          `Model-reported title: ${item.title || '(none)'}.`,
          `Model-reported publication date: ${item.publication_date || 'not stated'}.`,
          `Model-reported snippet: ${item.snippet || '(none)'}.`,
          'Search-based discovery only: the URL was not visited, no document was retrieved, and the title, date and snippet are model-written text rather than verified evidence.',
        ].join(' '),
        attempted_at: attemptedAt,
        attempted_by: actor.email,
        reason_category: 'Search-only lead — unverified, not a monitored source',
      });
      leads.push({ ...item, recorded: true, duplicate_note: '' });
    }
    if (toCreate.length) await base44.asServiceRole.entities.DiscoveryAttempt.bulkCreate(toCreate);

    const finishedAt = new Date().toISOString();
    const notes = [
      `${LABEL} only: one native web-search call for ${jurisdiction.name}.`,
      `${leads.length} lead(s) returned, ${toCreate.length} recorded, ${duplicates} already known, ${withoutUrl} without a usable URL.`,
      'No document was retrieved, no change was detected, no publisher was verified and nothing was approved.',
      callError ? `Search call error: ${callError}` : '',
    ].filter(Boolean).join(' ');

    await base44.asServiceRole.entities.DiscoveryRun.create({
      run_ref: runRef,
      run_kind: 'Source discovery',
      trigger_type: 'Manual',
      status: callError ? 'Failed' : 'Completed',
      batch_limit: MAX_ITEMS,
      processed: clean.length,
      candidates_created: toCreate.length,
      llm_calls: 1,
      credits_estimated: 1,
      credits_note: 'One native InvokeLLM call with web search (automatic model) = 1 integration credit. The app-side allowance is a conservative reservation, not a billing balance.',
      started_at: startedAt,
      finished_at: finishedAt,
      notes,
      failures: callError,
    });

    await logAudit(base44, actor, {
      event_type: 'Search-based discovery run',
      entity_type: 'DiscoveryRun',
      entity_id: runRef,
      entity_label: jurisdiction.name,
      summary: `${LABEL} for ${jurisdiction.name} as ${actor.email}: ${toCreate.length} unverified lead(s) recorded, ${duplicates} already known. No retrieval, no verification, no approval.`,
      detail: JSON.stringify({ run_ref: runRef, authority, site, topic, query_used: answer?.query_used || null, results_visible_reported: answer?.results_visible ?? null, leads: leads.map((l) => ({ url: l.url, recorded: l.recorded })) }),
      evidence_class: 'Search-only lead, not retrieved regulatory evidence',
      recorded_by: 'searchDiscovery',
    });

    return json({
      run_ref: runRef,
      label: LABEL,
      jurisdiction: jurisdiction.name,
      authority,
      site,
      topic,
      query_used_reported_by_model: answer?.query_used || null,
      results_visible_reported_by_model: answer?.results_visible ?? null,
      items_returned: clean.length,
      leads_recorded: toCreate.length,
      duplicates_skipped: duplicates,
      items_without_url: withoutUrl,
      credits_estimated: 1,
      monitoring_effect: 'none',
      change_detection: false,
      verification_effect: 'none',
      approval_effect: 'none',
      limitation: 'Search-based discovery only. Results are model-reported search leads: no document content, no document hash, no publisher verification and no change detection. Treat every URL and snippet as unverified until a human opens the publication.',
      leads,
      error: callError || null,
    });
  } catch (error) {
    return json({ error: error.message, code: error?.code || null }, 500);
  }
}