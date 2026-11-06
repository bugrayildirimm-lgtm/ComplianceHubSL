import { htmlToText, sha256 } from './compliance.ts';
import { canonicalUrl, permittedUrl, publicationLinks } from './publicationTraversal.ts';
import { reserveUsage } from './usageBudget.ts';
import { protectedFetch, requireProtectedFetch } from './protectedFetch.ts';

export async function retrievePublication(base44, url, source, allowExtraction = false) {
  requireProtectedFetch();
  if (!permittedUrl(url, source)) throw new Error('URL is outside the configured official-publisher traversal scope.');
  let response;
  let current = url;
  for (let redirects = 0; redirects <= 4; redirects++) {
    response = await protectedFetch(current, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html,application/pdf,text/plain,application/xml;q=0.9,*/*;q=0.5', 'User-Agent': 'StakelogicComplianceHub/1.0' } });
    if (![301,302,303,307,308].includes(response.status)) break;
    current = canonicalUrl(response.headers.get('location'), current);
    if (!permittedUrl(current, source)) throw new Error('Publisher redirect left the approved hosts. Provenance re-review is required.');
  }
  if (!response?.ok) throw new Error(`HTTP ${response?.status || 0} at ${url}`);
  const max = 8 * 1024 * 1024;
  const chunks = []; let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error('Document exceeds the bounded 8 MB retrieval limit; accessible official alternative required.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const pdf = type.includes('pdf') || /^%PDF/.test(new TextDecoder().decode(bytes.slice(0, 5)));
  const hash = await sha256(bytes);
  if (pdf) {
    let text = ''; let note = 'PDF text unavailable. Official HTML/text alternative or AI-assisted extraction is required.';
    if (allowExtraction) {
      const reservation = await reserveUsage(base44);
      if (reservation.ok) {
        const result = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({ file_url: current, json_schema: { type: 'object', properties: { text: { type: 'string', maxLength: 100000, description: 'Verbatim document text, not a summary. Preserve article and page references. Do not invent unreadable text.' } }, required: ['text'] } });
        text = String(result?.output?.text || '').slice(0, 100000);
        note = text ? 'AI-assisted PDF transcription; compare with original. OCR technique and completeness are not verified.' : `PDF extraction did not provide text: ${result?.details || result?.status || 'unavailable'}`;
      } else note = reservation.reason;
    }
    return { url: current, hash, text, html: '', title: decodeURIComponent(new URL(current).pathname.split('/').pop() || 'PDF publication'), links: [], status: response.status, size, extraction: text ? 'Partial' : 'Failed', note, uncertainty: true, pdf: true };
  }
  if (!/text|html|xml|json/.test(type)) return { url: current, hash, text: '', html: '', title: url, links: [], status: response.status, size, extraction: 'Failed', note: `Unsupported attachment format ${type}; an accessible official alternative is required.`, uncertainty: true };
  const html = new TextDecoder().decode(bytes);
  const text = /html|xml/.test(type) ? htmlToText(html) : html.trim();
  const blocked = /captcha|are you a robot|access denied|enable javascript|sign in to continue|403 forbidden/i.test(text.slice(0, 2500));
  const links = publicationLinks(html, current, source);
  // Try advertised, permitted official alternatives before treating a JS shell as unavailable.
  if ((blocked || text.length < 160) && allowExtraction) {
    const alt = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).filter(t => /alternate/i.test(t) && /text\/plain|text\/html|rss|atom|xml/i.test(t)).map(t => canonicalUrl(t.match(/href=["']([^"']+)/i)?.[1], current)).find(u => u && u !== current && permittedUrl(u, source));
    if (alt) { const result = await retrievePublication(base44, alt, source, false); return { ...result, note: `Official advertised alternative for ${url}. ${result.note || ''}` }; }
  }
  return { url: current, hash: await sha256(text), text: blocked ? '' : text.slice(0, 160000), html, title: htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).slice(0, 300), links, status: response.status, size, extraction: blocked || text.length < 160 ? 'Failed' : 'Complete', note: blocked ? 'Access barrier or JavaScript-only response; no bypass attempted. No permitted advertised alternative succeeded.' : text.length < 160 ? 'Too little extractable text. Rendering need is unconfirmed; review original and official alternatives.' : text.length > 160000 ? 'Research input is truncated; full-document completeness is not asserted.' : '', uncertainty: text.length > 160000 };
}