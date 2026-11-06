import { htmlToText, sha256 } from './compliance.ts';

export function canonicalUrl(value, base) {
  try {
    const u = new URL(value, base);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return '';
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return '';
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  } catch { return ''; }
}
export function permittedUrl(url, source) {
  const normalized = canonicalUrl(url);
  if (!normalized) return false;
  const host = new URL(normalized).hostname;
  const allowed = [new URL(source.url).hostname, ...(source.allowed_document_hosts || [])];
  if (!allowed.includes(host)) return false;
  return !(source.traversal_prefixes?.length) || source.traversal_prefixes.some(p => normalized.startsWith(p));
}
export function publicationLinks(html, base, source) {
  const links = new Map();
  const add = (href, label = '', attrs = '') => {
    const url = canonicalUrl(String(href).replace(/&amp;/g, '&'), base);
    const pagination = /rel\s*=\s*["'][^"']*next/i.test(attrs) || /(?:[?&](?:page|p|paged|offset|start)=\d+|\/page\/\d+)/i.test(url) || /^(next(?: page)?|older(?: posts)?|suivant|volgende|[›»]|\d+)$/i.test(label);
    if (!url || !permittedUrl(url, source)) return;
    if (!pagination && !/publication|news|consult|law|legisl|regulat|standard|requirement|decision|gazette|document|notice|guidance|technical|\.pdf(?:$|\?)|\.docx?(?:$|\?)|\.txt(?:$|\?)/i.test(`${url} ${label}`)) return;
    links.set(url, { url, label, kind: pagination ? 'Listing' : /\.(pdf|docx?|txt)(?:$|\?)/i.test(url) ? 'Attachment' : 'Publication' });
  };
  for (const m of html.matchAll(/<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) add(m[2], htmlToText(m[4]).slice(0, 180), `${m[1]} ${m[3]}`);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) { const href = m[0].match(/href\s*=\s*["']([^"']+)/i)?.[1]; if (href) add(href, '', m[0]); }
  for (const m of html.matchAll(/<link>\s*(?:<!\[CDATA\[)?(https?:[^<\]]+)/gi)) add(m[1].trim(), 'Publication feed document');
  return [...links.values()];
}
export async function publisherFingerprint(source) {
  return sha256(JSON.stringify([source.url, source.authority, source.jurisdiction_id, source.territorial_scope || '', [...(source.subject_coverage || source.topics || [])].sort(), source.provenance_reference_url || '']));
}
export function classifyVersion(prior, hash) {
  return prior?.content_hash === hash ? 'Unchanged' : prior ? 'Replaced at same URL' : 'New';
}