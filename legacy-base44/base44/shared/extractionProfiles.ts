// Source-specific extraction profiles. A profile only chooses which regions of a page the
// managed browser should read first, and which repeated blocks are listing furniture. It never
// decides whether a page is a publication — that is pageType.ts, from structure and content.
//
// PROFILE_VERSION is stored on every document, so a change of profile is never reported as a
// publisher amendment.
export const PROFILE_VERSION = 'profiles/1.0.0';

const GENERIC_REGIONS = ['article', 'main', '[role="main"]', '#main-content', '.main-content', '#content', '.content', 'body'];

const PROFILES = {
  'uk-gc': {
    id: 'uk-gc',
    label: 'Gambling Commission (UK) template',
    // Public statements and regulatory actions live under /public-register/... and are genuine
    // individual records; the register index pages are listings. Structure decides, not the path.
    regionSelectors: ['main#main-content', 'main', 'article', 'body'],
    listingBlockHints: ['news', 'latest', 'article', 'card', 'teaser', 'listing', 'results'],
  },
  mga: {
    id: 'mga',
    label: 'Malta Gaming Authority template',
    regionSelectors: ['main', 'article', '.content-area', '#content', 'body'],
    listingBlockHints: ['news', 'post', 'card', 'teaser', 'archive', 'related'],
  },
  fallback: {
    id: 'fallback',
    label: 'Conservative fallback for unfamiliar layouts',
    regionSelectors: GENERIC_REGIONS,
    listingBlockHints: ['card', 'teaser', 'listing', 'results', 'related'],
  },
};

export function profileFor(rawUrl) {
  let host = '';
  try {
    host = new URL(String(rawUrl)).hostname.toLowerCase();
  } catch (e) {
    host = '';
  }
  if (host.endsWith('gamblingcommission.gov.uk')) return PROFILES['uk-gc'];
  if (host.endsWith('mga.org.mt')) return PROFILES.mga;
  return PROFILES.fallback;
}

export function profileById(id) {
  return PROFILES[id] || PROFILES.fallback;
}