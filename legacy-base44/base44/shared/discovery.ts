// Shared helpers for official-source discovery and requirements baseline research.
// Server-side only.

import { htmlToText, substantiveText, shortText } from './compliance.ts';
import { protectedFetch, requireProtectedFetch } from './protectedFetch.ts';

export const TARGET_TOPICS = [
  'Market entry and licensing',
  'Slots technical standards',
  'Live casino technical standards',
  'Live studio and premises rules',
  'Enforcement and sanctions',
  'Legislation and gazette',
  'Consultations and bills',
];

export const SOURCE_TYPES = [
  'Regulator publication page', 'Technical standards', 'Legislation database', 'Official gazette',
  'Parliamentary bill or consultation', 'Court judgment', 'Enforcement publication', 'Other official',
];

const USER_AGENT = 'StakelogicComplianceHub/1.0 (official source discovery; compliance@stakelogic.com)';

export function priorityRank(classification = '') {
  const value = classification.toLowerCase();
  if (value.includes('licensed')) return 1;
  if (value.includes('conditionally')) return 2;
  if (value.includes('consideration') || value.includes('prospective')) return 3;
  if (value.includes('prohibited')) return 4;
  return 5;
}

// Retrieves the candidate URL itself. Search results are never accepted as
// evidence: only a real publisher response, its title and its text count.
export async function testCandidateSource(url, timeoutMs = 12000) {
  requireProtectedFetch();
  const base = { url, ok: false, status: 0, final_url: url, title: '', content_type: '', is_pdf: false, blocked: false, excerpt: '', bytes: 0, error: '' };
  if (!/^https?:\/\//i.test(url || '')) return { ...base, error: 'Not an absolute http(s) URL' };
  try {
    const res = await protectedFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isPdf = contentType.includes('pdf') || /\.pdf($|\?)/i.test(url);
    let title = '';
    let blocked = false;
    let excerpt = '';
    let bytes = 0;

    if (isPdf) {
      const buffer = await res.arrayBuffer();
      bytes = buffer.byteLength;
      title = decodeURIComponent((url.split('/').pop() || '').split('?')[0]).slice(0, 220);
      excerpt = `PDF document, ${bytes} bytes. Text extraction is not configured, so its wording cannot yet be evidenced.`;
    } else {
      const html = await res.text();
      bytes = html.length;
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = htmlToText(titleMatch?.[1] || '').slice(0, 220);
      const plain = htmlToText(html);
      const head = plain.slice(0, 3000);
      blocked = /(captcha|are you a robot|access denied|enable javascript|sign in to continue|login required|403 forbidden)/i.test(head);
      excerpt = substantiveText(plain).slice(0, 700);
    }

    return { ...base, ok: res.ok, status: res.status, final_url: res.url || url, title, content_type: contentType, is_pdf: isPdf, blocked, excerpt, bytes };
  } catch (error) {
    return { ...base, error: shortText(String(error?.message || error), 200) };
  }
}

export function publisherEvidence(url, probe, authority) {
  const host = (() => { try { return new URL(probe.final_url || url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const officialTld = /\.(gov|gouv|govt|gob|gv|gov\.uk|gov\.mt|gc\.ca|gov\.au|go\.jp|gov\.br|gov\.za|gov\.in|gov\.es|gov\.it|gov\.fr|gov\.de|gov\.nl|gov\.se|gov\.dk|gov\.fi|gov\.no|gov\.pl|gov\.pt|gov\.gr|gov\.ie|gov\.cy|gov\.ro|gov\.bg|gov\.hr|gov\.si|gov\.sk|gov\.cz|gov\.lt|gov\.lv|gov\.ee|gov\.lu|gov\.at|gov\.be)$/i.test(host);
  const lines = [
    `Retrieved ${new Date().toISOString().slice(0, 10)} with HTTP ${probe.status || 'error'}${probe.error ? ` (${probe.error})` : ''} from ${host || 'unknown host'}.`,
    probe.title ? `Publisher page title: "${probe.title}".` : '',
    probe.blocked ? 'The response looks like a login wall or access block; it cannot be used as evidence.' : '',
    probe.is_pdf ? 'Candidate is a PDF document; wording verification is pending text extraction.' : '',
    officialTld ? 'Host is on an official government domain.' : 'Host is not on a government domain, so the publishing authority must be confirmed by a person.',
    `Proposed publishing authority: ${authority || 'unstated'}.`,
  ];
  return lines.filter(Boolean).join(' ');
}

export function creditNote(llmCalls, assumption) {
  return `${llmCalls} AI call(s). Estimate assumes the default automatic model at roughly 1 integration credit per call, plus retrieval requests which are not billed as integration credits. ${assumption || ''}`.trim();
}

export function isAmbiguousRecord(jurisdiction) {
  const flags = [
    jurisdiction?.duplicate_group,
    jurisdiction?.possible_duplicate_of,
    jurisdiction?.review_flags,
  ].filter(Boolean).join(' ');
  return /duplicate|merge|caym/i.test(flags);
}