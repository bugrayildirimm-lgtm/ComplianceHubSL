// Direct publisher fetching stays disabled for every general caller (collectSources, discovery, research,
// correctMarketBlock, the scheduler): requireProtectedFetch / protectedFetch / outboundDecision below still refuse,
// and FETCH_MAINTENANCE.paused stays true. Nothing in THIS file performs a network request.
//
// The one exception is the Source review "Retrieve sample" action (sourceReview op 'inspect'). When the owner sets
// DIRECT_FETCH_ENABLED=true (and FETCH_CONTACT), that action uses the separate bounded fetcher in inspectFetch.ts.
// directFetchConfig() below is the single place that reads those settings.
// Search-based discovery uses Base44's native web-search integration through its own bounded function.
export const DIRECT_FETCH_DISABLED_CODE = 'DIRECT_FETCH_DISABLED';

export const FETCH_MAINTENANCE = Object.freeze({
  paused: true,
  code: DIRECT_FETCH_DISABLED_CODE,
  message: 'Direct publisher retrieval is disabled',
  reason: 'Direct publisher retrieval is disabled: no approved retrieval transport exists, so nothing is fetched. Saved queues, continuation points and evidence are retained.',
  requiredCapability: 'Native search-based discovery through the Base44 web-search integration is available for leads. Complete document retrieval and document-change detection remain unavailable without an approved transport.',
});

export function requireProtectedFetch() {
  const error = new Error(FETCH_MAINTENANCE.message);
  error.status = 503;
  error.code = DIRECT_FETCH_DISABLED_CODE;
  throw error;
}

export function outboundDecision(_url, _context = {}) {
  return { allowed: false, code: DIRECT_FETCH_DISABLED_CODE };
}

export async function protectedFetch(_url, _options = {}) {
  requireProtectedFetch();
}

// Settings for the Retrieve-sample fetcher (inspectFetch.ts). Read at call time so they can be changed with a restart.
//   DIRECT_FETCH_ENABLED  default false. When false, behaviour is exactly the paused behaviour above.
//   FETCH_CONTACT         required when enabled; goes into the user agent (a URL or email address, never hard-coded).
//   FETCH_TIMEOUT_MS      per request, default 20000.   FETCH_MAX_BYTES  default 10485760 (10 MB).
//   FETCH_MAX_REDIRECTS   default 5 (hard cap 10).      FETCH_RENDER     default false (Playwright fallback).
export function directFetchConfig(env = process.env) {
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
  };
  const enabled = String(env.DIRECT_FETCH_ENABLED || '').trim().toLowerCase() === 'true';
  const contact = String(env.FETCH_CONTACT || '').trim();
  const contactValid = /^[^\s()<>]{3,200}$/.test(contact);
  return {
    enabled,
    contact,
    // ready = may actually fetch. Enabled without a valid contact is a configuration error, not permission.
    ready: enabled && contactValid,
    problem: enabled && !contactValid ? 'DIRECT_FETCH_ENABLED is true but FETCH_CONTACT is missing or invalid (use a URL or email address without spaces or brackets).' : '',
    timeoutMs: num(env.FETCH_TIMEOUT_MS, 20000, 1, 120000),
    maxBytes: num(env.FETCH_MAX_BYTES, 10485760, 1, 104857600),
    maxRedirects: Math.floor(num(env.FETCH_MAX_REDIRECTS, 5, 0, 10)),
    render: String(env.FETCH_RENDER || '').trim().toLowerCase() === 'true',
    minGapMs: 2000,
    userAgent: `StakelogicComplianceHub/1.0 (+${contact})`,
  };
}
