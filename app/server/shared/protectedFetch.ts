// Direct publisher fetching stays disabled. There is no unrestricted fallback and no
// external service to configure: nothing in this module performs a network request.
// Search-based discovery uses Base44's native web-search integration through its own
// bounded function and never comes through this guard.
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