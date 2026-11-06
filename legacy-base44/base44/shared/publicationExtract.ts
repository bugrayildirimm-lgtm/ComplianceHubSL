// Substantive-content extraction and comparison for captured official pages.
// The capture itself is preserved untouched as evidence; this module derives the
// comparable text so menus, banners and listing order do not look like amendments.
// EXTRACTOR_VERSION is stored on every document: changing the rules must never be
// mistaken for a publisher amendment.
import { sha256Hex, normalizeWhite } from './managedBrowser.ts';

// Bumped when the text being compared changes basis (the classified publication body rather than
// the whole extracted page). Comparison therefore treats earlier captures as not comparable and
// re-baselines them, instead of reporting a publisher amendment that never happened.
export const EXTRACTOR_VERSION = 'publication-extract/2+classified';

const NAV_LINE = /^(skip to|open toolbar|accessibility|increase text|decrease text|grayscale|high contrast|negative contrast|light background|links underline|readable font|reset|cookie|accept all|accept|reject all|reject|search|menu|close|share|print|back to top|home|news|read more|learn more|view all|previous|next|loading|javascript)\b/i;

const CHROME_ONLY = /^(subscribe|sign up|log in|login|newsletter|follow us|contact us|privacy policy|terms of use|cookie policy|sitemap|careers|©|copyright)\b/i;

export function canonicalUrl(raw) {
  try {
    const url = new URL(String(raw));
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) =>
      url.searchParams.delete(key)
    );
    return url.toString().replace(/\/$/, '');
  } catch (e) {
    return String(raw || '').trim();
  }
}

export function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function isNavigationLine(line) {
  if (NAV_LINE.test(line) || CHROME_ONLY.test(line)) return true;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && !/(19|20)\d{2}/.test(line)) return true;
  return false;
}

// Deterministic, rule-based extraction. Returns derived text plus what was dropped,
// so the scope of the extraction is auditable.
export function extractSubstantive(raw) {
  const normalized = normalizeWhite(raw);
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const kept = [];
  for (const line of lines) {
    if (isNavigationLine(line)) continue;
    if (line.length < 40 && !/[.:;]$/.test(line) && !/(19|20)\d{2}/.test(line)) continue;
    if (kept.length && kept[kept.length - 1] === line) continue;
    kept.push(line);
  }
  const text = kept.join('\n').trim();
  return {
    text,
    extractorVersion: EXTRACTOR_VERSION,
    inputLines: lines.length,
    keptLines: kept.length,
    droppedLines: Math.max(0, lines.length - kept.length),
    keptChars: text.length,
  };
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad(value) {
  return String(value).padStart(2, '0');
}

// Only dates actually present in the captured text are returned.
export function publicationDateFrom(text) {
  const source = String(text || '');
  const iso = source.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const dmy = source.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (dmy) return `${dmy[3]}-${pad(MONTHS[dmy[2].toLowerCase()])}-${pad(dmy[1])}`;
  const mdy = source.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (mdy) return `${mdy[3]}-${pad(MONTHS[mdy[1].toLowerCase()])}-${pad(mdy[2])}`;
  return '';
}

// An "enforcement action" needs evidence of an actual announced action, proceeding or
// decision. A warning that non-compliance *may* lead to enforcement is a reminder about
// existing obligations, not an enforcement action (corrected 2026-11-05).
const ACTUAL_ENFORCEMENT = [
  /\b(?:has|have|was|were)\s+(?:imposed|issued|fined|suspended|revoked|withdrawn|cancelled)\b/i,
  /\bimpos(?:ed|es)\s+(?:a|an|the)?\s*(?:fine|penalt|administrative sanction|regulatory sanction)/i,
  /\b(?:suspended|revoked|withdrawn|cancelled)\s+(?:the|its|their)\s+(?:licence|license|authorisation|authorization|permit)/i,
  /\bcommenced\s+(?:enforcement\s+)?proceedings\b/i,
  /\bcease\s+and\s+desist\s+order\b/i,
  /\bdecision\s+to\s+(?:fine|suspend|revoke|withdraw)\b/i,
  /\b(?:administrative|disciplinary)\s+(?:fine|penalty)\s+(?:of|amounting)/i,
];

export function hasActualEnforcementEvidence(text) {
  const source = String(text || '');
  return ACTUAL_ENFORCEMENT.some((pattern) => pattern.test(source));
}

// Legal stage strictly as evidenced by wording in the captured text.
export function legalStageFrom(text) {
  const source = String(text || '');
  if (hasActualEnforcementEvidence(source)) return 'Enforcement action';
  if (/(court|judgment|judgement|tribunal ruling)/i.test(source)) return 'Court judgment';
  if (/(conclud(?:es|ed|ing)\s+(?:the\s+|its\s+)?consultation|consultation\s+(?:outcome|response|feedback))/i.test(source)) {
    return 'Official announcement or discussion';
  }
  if (/(in force|come[s]? into force|entered into force|effective from|shall apply from)/i.test(source)) return 'In force';
  if (/(consultation|call for evidence|call for input)/i.test(source)) return 'Consultation';
  if (/(draft|proposal|proposed amendments|bill)/i.test(source)) return 'Proposal or draft legislation';
  if (/(remind(?:s|er|ing)?|existing obligations|guidance|guidance note|policy statement|FAQ|is expected to|are expected to)/i.test(source)) {
    return 'Official guidance';
  }
  if (/(announce|notice|update|statement|findings)/i.test(source)) return 'Official announcement or discussion';
  return 'Unknown';
}

// Publication type is a different axis from legal stage, novelty and applicability.
export function publicationTypeFrom(text) {
  const source = String(text || '');
  if (/(remind(?:s|er|ing)?|existing obligations)/i.test(source)) return 'Official reminder or guidance on existing obligations';
  if (/(conclud(?:es|ed|ing)\s+(?:the\s+|its\s+)?consultation)/i.test(source)) return 'Consultation outcome / framework development';
  if (/(thematic review|findings of|supervisory review)/i.test(source)) return 'Findings or thematic review';
  if (/(consultation|call for evidence|call for input)/i.test(source)) return 'Consultation';
  if (/(directive|regulations?\b|act\b|legal notice|recognition notice)/i.test(source)) return 'Legislative or regulatory instrument';
  if (hasActualEnforcementEvidence(source)) return 'Enforcement action or decision';
  if (/(guidance|guidance note|policy statement|FAQ)/i.test(source)) return 'Policy statement or guidance note';
  if (/(announce|news|update|statement)/i.test(source)) return 'General announcement';
  return 'Unknown';
}

// Novelty is decided from evidenced dates, not from detection time.
export function noveltyFrom(publicationDate, detectedAt) {
  if (!publicationDate) {
    return { classification: 'Unknown — no publication date evidenced', basis: 'No publication date appeared in the captured content; novelty cannot be decided and is not claimed.' };
  }
  const published = Date.parse(publicationDate);
  const detected = Date.parse(detectedAt);
  if (Number.isNaN(published) || Number.isNaN(detected)) {
    return { classification: 'Unknown — unparseable date', basis: `Evidenced date "${publicationDate}" could not be compared with the detection time.` };
  }
  const days = Math.floor((detected - published) / 86400000);
  if (days > 45) {
    return { classification: 'Previously untracked / historical', basis: `Evidenced publication date ${publicationDate} is ${days} days before first detection; treated as existing material, not a new regulatory change.` };
  }
  if (days < -1) {
    return { classification: 'Unknown — future-dated in content', basis: `Evidenced date ${publicationDate} is later than detection; classification deferred to human review.` };
  }
  return { classification: 'Newly published', basis: `Evidenced publication date ${publicationDate} is ${days} day(s) before first detection.` };
}

export function compareSubstantive(prior, next) {
  if (!prior || !prior.substantiveHash) return 'No prior substantive version';
  if (prior.extractorVersion && prior.extractorVersion !== next.extractorVersion) {
    return 'Extractor version changed — not comparable';
  }
  return prior.substantiveHash === next.substantiveHash ? 'Unchanged' : 'Amended';
}

export async function substantiveHash(text) {
  return sha256Hex(String(text || ''));
}

export function isAttachmentLink(href) {
  return /\.(pdf|docx?|xlsx?|zip)(\?|#|$)/i.test(String(href || ''));
}

// Publication candidate selection from links the browser actually saw on the page.
export function pickPublicationLinks(links, sourceUrl, options = {}) {
  const listingHost = hostOf(sourceUrl);
  const allowedHosts = new Set([listingHost, ...(options.allowedHosts || []).map((h) => String(h).toLowerCase())]);
  const skip = /(contact|about|careers|login|sign in|privacy|cookie|terms|sitemap|subscribe|newsletter|facebook|twitter|linkedin|youtube|instagram|mailto|tel:)/i;
  const seen = new Set();
  const out = [];
  for (const link of links || []) {
    const href = String(link.href || '').trim();
    if (!/^https?:\/\//i.test(href)) continue;
    if (isAttachmentLink(href)) continue;
    if (!allowedHosts.has(hostOf(href))) continue;
    if (skip.test(href)) continue;
    const canonical = canonicalUrl(href);
    if (canonical === canonicalUrl(sourceUrl)) continue;
    if (seen.has(canonical)) continue;
    const label = String(link.label || '').trim();
    if (/^(read more|learn more|more|view|next|previous|\d+)$/i.test(label) && !/(news|publication|notice|consultation|guidance|decision)/i.test(href)) continue;
    const looksPublication = /(news|publication|notice|consultation|guidance|decision|policy|statement|enforcement|regulation|press|update)/i.test(href)
      || label.split(/\s+/).filter(Boolean).length >= 4;
    if (!looksPublication) continue;
    seen.add(canonical);
    out.push({ url: canonical, label: label.slice(0, 160) });
  }
  return out;
}

// A register, directory, section or archive page is not an individual publication. Capturing
// it is still evidence, but it must never become a draft alert. Section words are matched on an
// exact final path segment only, so a slug such as ".../proposed-updates-to-recognition-notice"
// is not mistaken for a listing (hardened 2026-11-05 after /news/latest was captured as one).
const SECTION_SEGMENTS = new Set([
  'news', 'latest', 'latest-news', 'newsroom', 'press', 'press-releases', 'media', 'media-centre',
  'updates', 'update', 'industry', 'consumers', 'enforcement', 'publications', 'statistics',
  'consultations', 'guidance', 'archive', 'index', 'all', 'topics', 'categories', 'tag', 'tags',
  'news-and-updates', 'whats-new',
]);

export function isIndexLikeUrl(raw, title = '') {
  let path = String(raw || '').toLowerCase();
  try {
    path = new URL(String(raw)).pathname.toLowerCase();
  } catch (e) {
    path = String(raw || '').toLowerCase();
  }
  // A register/directory segment only makes this a listing when the path ends there: an
  // individual entry such as /public-register/public-statement/detail/<id> is a document.
  if (/\/(register|registrar|directory|sitemap)(\/|$)/.test(path) || /-register$/.test(path)) return true;
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  if (segments.length && SECTION_SEGMENTS.has(last)) return true;
  // One level under a news section is a category index when the segment is a short category
  // label; a long slug there is an article (/guidance/<slug> is always a document).
  const second = segments[1] || '';
  if (segments.length === 2 && /^(news|newsroom|press|media|updates)$/.test(segments[0])
    && second.length <= 26 && second.split('-').length <= 3) return true;
  const heading = String(title || '').trim();
  if (/\b(concludes|concluded|publishes|announces|reminds|calls for|issues|imposes|fines|suspends|revokes)\b/i.test(heading)) return false;
  if (/^(news|latest news|newsroom|press|updates|what'?s new|recent|media|publications|consultations|enforcement|industry news|all news)\b/i.test(heading)) return true;
  return /\b(register|directory|search results|archive|index of|list of)\b/i.test(heading);
}

export function attachmentLinksFrom(links, pageUrl) {
  const pageHost = hostOf(pageUrl);
  const out = [];
  const seen = new Set();
  for (const link of links || []) {
    const href = String(link.href || '').trim();
    if (!/^https?:\/\//i.test(href) || !isAttachmentLink(href)) continue;
    if (hostOf(href) !== pageHost) continue;
    const canonical = canonicalUrl(href);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ url: canonical, label: String(link.label || '').trim().slice(0, 160) });
  }
  return out;
}