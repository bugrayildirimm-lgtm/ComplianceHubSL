// STEP 1 of classification: what kind of page is this?
//
// Deliberately structural. URL patterns, headings and metadata are recorded as supporting
// evidence only — they never decide the page type on their own, because genuine publications
// sit under /news/ and /public-register/ paths and a section word is not a listing.
//
// Regulatory meaning (publication type, legal stage, applicability) is decided afterwards, only
// for a page typed as an individual publication. See classifyLegalMeaning() in collectManaged.
import { extractSubstantive } from './publicationExtract.ts';
import { profileFor } from './extractionProfiles.ts';

export const CLASSIFIER_VERSION = 'page-type/2.0.1';

export const PAGE_TYPES = {
  LISTING: 'Listing or index',
  INDIVIDUAL: 'Individual publication',
  AMBIGUOUS: 'Ambiguous or incomplete',
};

const MIN_PROSE_INDIVIDUAL = 900;
const MIN_PROSE_SHORT = 450;
const MIN_REGION_CHARS = 400;
const SUBSTANTIVE_RECORD_CHARS = 180;

function lineKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Assemble the comparable text of an individual publication: the selected content region, minus
 * repeated card blocks (article teasers, "other news"), but keeping the article's own metadata
 * lines (dates, authorities, references) even when the template renders them in a header strip.
 */
function regionSubstantiveText(structure, cardLabels) {
  const regionText = String(structure.regionText || '');
  const labels = cardLabels instanceof Set ? cardLabels : new Set();
  const kept = [];
  for (const raw of regionText.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (labels.has(lineKey(line))) continue; // teaser headline of another article, not this one
    kept.push(line);
  }
  const metadata = [];
  for (const value of [...(structure.times || []), ...(structure.meta || [])]) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 200) continue;
    if (metadata.some((m) => lineKey(m) === lineKey(text))) continue;
    metadata.push(text);
  }
  const extract = extractSubstantive(kept.join('\n'));
  const text = [extract.text, metadata.join('\n')].filter(Boolean).join('\n').trim();
  return { text, extract, metadata };
}

/**
 * Classify a capture. `structure` comes from the managed browser's structural snapshot; when it
 * is missing the page is never guessed — it is retained as ambiguous and sent to review.
 */
export function classifyPage({ url, title, text, structure }) {
  const profile = profileFor(url);
  const basis = [];
  const s = structure && typeof structure === 'object' ? structure : null;

  if (!s || !Number(s.bodyChars) || !String(s.regionText || '').trim()) {
    basis.push('No structural snapshot was available, so page type cannot be established from structure.');
    return {
      version: CLASSIFIER_VERSION,
      profile: profile.id,
      pageType: PAGE_TYPES.AMBIGUOUS,
      pageTypeCode: 'ambiguous',
      basis,
      indicators: {},
      substantiveText: '',
      extract: extractSubstantive(''),
      retainedMetadata: [],
      regionSelector: '',
      itemRecords: [],
      listingHasSubstantiveRecords: false,
      uncertain: true,
    };
  }

  const proseChars = Number(s.proseChars) || 0;
  const paragraphs = Number(s.paragraphCount) || 0;
  const cardBlocks = Number(s.cardBlockCount) || 0;
  const cardChars = Number(s.cardChars) || 0;
  const regionChars = Number(s.regionChars) || 0;
  const averageCardChars = cardBlocks ? Math.round(cardChars / cardBlocks) : 0;
  const averageParagraphChars = paragraphs ? Math.round(proseChars / paragraphs) : 0;
  const headings = (s.h1 || []).concat(s.headings || []).filter(Boolean);

  // An individual publication is prose, not a card. A short official notice is still a
  // publication, so the prose floor is low; what rules a page out is repeated cards dominating
  // the region, pagination/filters, or no prose at all.
  const articleProse = proseChars >= MIN_PROSE_INDIVIDUAL && paragraphs >= 3 && headings.length > 0;
  const shortPublication = proseChars >= MIN_PROSE_SHORT && proseChars < MIN_PROSE_INDIVIDUAL
    && paragraphs >= 3 && headings.length > 0 && cardBlocks <= 2;
  const cardHeavy = cardBlocks >= 4 && (cardChars > proseChars * 1.5 || proseChars < MIN_PROSE_SHORT);
  const pagedIndex = Boolean(s.hasPagination) && cardBlocks >= 3 && proseChars < MIN_PROSE_INDIVIDUAL;
  const noProseAtAll = paragraphs <= 2 && cardBlocks >= 5;
  // A register whose records sit in the page as short blocks and are not wrapped in repeated
  // siblings (the MGA enforcement register): hundreds of short paragraphs, few headings. A
  // publication body does not read like that.
  const recordList = paragraphs >= 100 && averageParagraphChars < 400 && headings.length <= 6;
  // A register landing page looks like a short article to structure alone: the authority's own
  // explanation of the register, its field list and a download link, with the entries behind a
  // search form. Its content still names the register's size and framing, which an individual
  // publication does not. Corrected 2026-11-05 for /public-register/businesses, which was typed
  // "Individual publication" from 1207 characters of register description.
  const regionText = String(s.regionText || '');
  const recordCount = /\b\d{1,3}(?:,\d{3})*\s+(?:records|entries)\b/i.test(regionText);
  const registerFraming = /\b(full register|download the register|register of|fields in this register)\b/i.test(regionText);
  const registerIndex = recordCount && registerFraming;
  const listingIndicators = [cardHeavy, pagedIndex, noProseAtAll].filter(Boolean);

  if (cardHeavy) basis.push(`${cardBlocks} repeated card blocks (${cardChars} characters of card text) against ${proseChars} characters of prose.`);
  if (pagedIndex) basis.push(`Pagination beside ${cardBlocks} card blocks and ${proseChars} characters of prose.`);
  if (noProseAtAll) basis.push(`Only ${paragraphs} paragraph(s) of prose against ${cardBlocks} card blocks.`);
  if (articleProse) basis.push(`${paragraphs} paragraphs of prose (${proseChars} characters) with ${headings.length} heading(s) in the main region.`);
  if (shortPublication) basis.push(`Short publication: ${paragraphs} paragraphs (${proseChars} characters) with a heading and no repeated cards.`);

  let pageTypeCode = 'ambiguous';
  if (registerIndex) {
    // Decisive: an index remains an index even when the page explains itself in prose.
    pageTypeCode = 'listing';
    basis.push(`Register index: the region states a record count and describes the register itself (download/full register), so the entries are records to be read individually, not this page's content.`);
  } else if (recordList) {
    pageTypeCode = 'listing';
    basis.push(`Register-style content: ${paragraphs} short blocks averaging ${averageParagraphChars} characters under ${headings.length} heading(s), which is a list of records rather than a publication body.`);
  } else if (listingIndicators.length) {
    // A long article with a teaser sidebar is still an article: prose must not be outweighed.
    if (articleProse && cardChars < proseChars * 2) {
      pageTypeCode = 'individual';
      basis.push('Listing furniture is present but article prose outweighs it, so the page is the publication itself.');
    } else if (articleProse || shortPublication) {
      basis.push('Structure gives conflicting signals: publication prose alongside listing indicators that dominate the region. Retained for review.');
    } else {
      pageTypeCode = 'listing';
    }
  } else if (articleProse || shortPublication) {
    pageTypeCode = 'individual';
  } else if (regionChars < MIN_REGION_CHARS) {
    basis.push(`The selected region holds only ${regionChars} characters; the capture is incomplete.`);
  } else {
    basis.push('Neither article prose nor repeated cards dominate, so the page type is left unresolved.');
  }

  if (profile.id !== 'fallback') basis.push(`Extraction profile: ${profile.label}.`);
  basis.push(`Region selected: ${s.regionSelector || 'body'} (prose ${proseChars} chars, ${paragraphs} paragraphs).`);

  const cardLabels = new Set((s.cardLinks || []).map((l) => lineKey(l && l.label)));
  const assembled = pageTypeCode === 'individual'
    ? regionSubstantiveText(s, cardLabels)
    : { text: '', extract: extractSubstantive(''), metadata: [] };

  // Register-style listings that carry substantive records directly on the page: each record is
  // captured with a stable identifier and its own evidence line instead of being discarded.
  const listingHasSubstantiveRecords = pageTypeCode === 'listing' && cardBlocks >= 8 && averageCardChars >= 80;
  const itemRecords = listingHasSubstantiveRecords
    ? (s.cardLinks || [])
      .filter((l) => l && l.href && String(l.label || '').trim().length > 12)
      .slice(0, 40)
      .map((l) => {
        let slug = '';
        try {
          const parts = new URL(l.href).pathname.split('/').filter(Boolean);
          slug = parts[parts.length - 1] || '';
        } catch (e) {
          slug = '';
        }
        return {
          identifier: slug || lineKey(l.label).slice(0, 60),
          label: String(l.label).trim().slice(0, 180),
          url: String(l.href),
        };
      })
    : [];

  return {
    version: CLASSIFIER_VERSION,
    profile: profile.id,
    pageType: PAGE_TYPES[pageTypeCode.toUpperCase()],
    pageTypeCode,
    basis,
    indicators: {
      proseChars, paragraphs, cardBlocks, cardChars, averageCardChars, regionChars,
      hasPagination: Boolean(s.hasPagination), hasSearchControls: Boolean(s.hasSearchControls),
      chromeChars: s.chromeChars || {}, regionSelector: s.regionSelector || 'body',
    },
    substantiveText: assembled.text,
    extract: assembled.extract,
    retainedMetadata: assembled.metadata,
    regionSelector: s.regionSelector || 'body',
    itemRecords,
    listingHasSubstantiveRecords,
    uncertain: pageTypeCode === 'ambiguous',
  };
}

export function titleSuggestsSection(title) {
  // Supporting signal only. Never used to decide a page type.
  return /\b(register|directory|archive|index|search results|list of)\b/i.test(String(title || ''));
}