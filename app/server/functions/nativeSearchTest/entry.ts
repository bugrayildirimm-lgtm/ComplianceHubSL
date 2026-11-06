import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { json } from '../../shared/compliance.ts';

// Bounded runtime test of Base44's native InvokeLLM web-search integration.
// Purpose: report exactly what the integration returns, so nobody mistakes
// model-written URLs or quotations for retrieved regulatory evidence.
// No document, source, alert or requirement is written by this function.

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string', description: 'URL exactly as it appeared in the search results; empty string if none was visible' },
          publication_date: { type: 'string', description: 'YYYY-MM-DD only if stated in the result; otherwise empty string' },
          snippet: { type: 'string', description: 'Text from the search result, copied not paraphrased' },
          is_primary_official_source: { type: 'boolean' },
        },
        required: ['title', 'url', 'publication_date', 'snippet', 'is_primary_official_source'],
      },
    },
    query_used: { type: 'string' },
    results_visible: { type: 'number', description: 'How many distinct search results the model actually saw' },
  },
  required: ['items', 'query_used', 'results_visible'],
};

export default async function (req) {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return json({ error: 'Sign-in required' }, 401);

    const body = await req.json().catch(() => ({}));
    const authority = String(body.authority || 'Malta Gaming Authority').slice(0, 120);
    const site = String(body.site || 'mga.org.mt').slice(0, 120);
    const topic = String(body.topic || 'technical standards and game testing requirements').slice(0, 200);
    const shape = body.shape === 'plain' ? 'plain' : 'json';
    const started = Date.now();

    const prompt = [
      'You are assisting a gambling-supplier compliance team with SEARCH-BASED DISCOVERY only.',
      `Search the web for recent official publications from ${authority} (${site}) about ${topic}.`,
      'Only report what you actually see in search results. Do not invent titles, URLs, dates or quotations.',
      'If a fact is not visible in a search result, leave the field empty.',
      'Mark is_primary_official_source true only when the result is on the authority\'s own domain.',
    ].join('\n');

    const call = shape === 'json'
      ? await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt, add_context_from_internet: true, model: 'automatic', response_json_schema: SCHEMA })
      : await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: `${prompt}\n\nAnswer in plain prose and list every source URL you saw.`, add_context_from_internet: true, model: 'automatic' });

    const elapsed = Date.now() - started;
    const raw = call;
    const parsed = shape === 'json' && call && typeof call === 'object' ? call : null;
    const asText = typeof call === 'string' ? call : JSON.stringify(call);
    const urlsInAnswer = Array.from(new Set((asText.match(/https?:\/\/[^\s"',)\]]+/g) || [])));

    return json({
      shape,
      model_requested: 'automatic',
      web_search_requested: true,
      elapsed_ms: elapsed,
      response_type: typeof call,
      raw_response: raw,
      parsed_items: parsed?.items || null,
      results_visible_reported: parsed?.results_visible ?? null,
      urls_found_in_response: urlsInAnswer,
      evidence_notes: {
        retrieval_metadata_returned_by_integration: 'Only the model answer is returned; the integration response here contains no grounding, citation or retrieval-metadata field. See response_keys.',
        response_keys: call && typeof call === 'object' ? Object.keys(call) : [],
        urls_are_verifiable_from_this_response: false,
        persisted: false,
      },
      credits_note: 'One InvokeLLM call with the automatic/default model: 1 integration credit. Model selection was left automatic; no other paid service was used.',
    });
  } catch (error) {
    return json({ error: error.message, code: error?.code || null, stage: 'native_search_test' }, 500);
  }
}