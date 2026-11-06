// One validated, pinned retrieval. Returns a structured envelope; never a raw proxied response.
import { CONTRACT_VERSION } from './config.js';
import { createPolicy, validateResolvedAddresses, validateUrl } from './policy.js';
import { defaultResolver, pinnedGet } from './pinnedRequest.js';

const TEXT_TYPES = /^(text\/html|application\/xhtml\+xml|application\/pdf|text\/plain|application\/xml|text\/xml|application\/json)\b/i;
const BINARY_OK = /^application\/pdf\b/i;

export function createRetriever({ config, resolver = defaultResolver, policy: policyOverride = null }) {
  const policy = policyOverride || createPolicy({ approvedHosts: config.approvedHosts, allowedPorts: config.allowedPorts });

  return async function retrieve(input) {
    const startedAt = new Date();
    const requestId = input.request_id;
    const mode = input.mode === 'candidate' ? 'candidate' : 'monitoring';
    const maxBytes = mode === 'candidate' ? config.candidateMaxBytes : config.maxBytes;
    const envelope = {
      contract_version: CONTRACT_VERSION,
      request_id: requestId,
      source_ref: input.source_ref || null,
      mode,
      requested_url: input.url,
      final_url: input.url,
      retrieved_at: startedAt.toISOString(),
      http_status: 0,
      redirects: [],
      content_type: '',
      content_length: 0,
      content_base64: null,
      content_sha256: '',
      completeness: 'not_retrieved',
      publication_date: null,
      publication_date_note: 'Retrieval timestamp is not a publication date; evidence the publication date from the document itself.',
      limits: { max_bytes: maxBytes, timeout_ms: config.timeoutMs, redirects_used: 0, redirects_allowed: config.maxRedirects },
      trusted_for_monitoring: mode === 'monitoring',
      approval_effect: 'none',
      ok: false,
    };

    if (mode === 'candidate' && !config.allowCandidate) {
      return { envelope, error: { status: 403, code: 'CANDIDATE_MODE_DISABLED', message: 'Candidate testing is disabled on this retriever.' } };
    }

    let current = input.url;
    let hops = 0;
    for (;;) {
      const target = validateUrl(current, { mode, policy });
      if (!target.ok) return { envelope, error: { status: 403, code: target.code, message: target.message } };

      let addresses;
      try {
        addresses = await resolver(target.hostname);
      } catch (error) {
        return { envelope, error: { status: 502, code: 'RESOLUTION_FAILED', message: error.message, retryable: true } };
      }
      const pinned = validateResolvedAddresses(addresses, { policy });
      if (!pinned.ok) return { envelope, error: { status: 403, code: pinned.code, message: pinned.message } };

      const url = new URL(target.url);
      const response = await pinnedGet({
        hostname: target.hostname,
        address: pinned.address,
        family: pinned.family,
        port: target.port,
        path: `${url.pathname}${url.search}`,
        timeoutMs: config.timeoutMs,
        maxBytes,
        userAgent: config.userAgent,
        accept: config.accept,
      });

      if (!response.ok) {
        const status = response.code === 'TIMEOUT' ? 504 : response.code === 'RESPONSE_TOO_LARGE' ? 413 : 502;
        return { envelope, error: { status, code: response.code, message: response.message, stage: response.stage, retryable: Boolean(response.retryable) } };
      }

      envelope.http_status = response.status;
      envelope.final_url = target.url;
      envelope.limits.redirects_used = hops;

      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      if (isRedirect) {
        const location = response.headers.location;
        let next = '';
        try {
          next = location ? new URL(location, target.url).toString() : '';
        } catch {
          next = '';
        }
        envelope.redirects.push({ from: target.url, to: next || null, status: response.status });
        if (!next) return { envelope, error: { status: 502, code: 'REDIRECT_WITHOUT_LOCATION', message: 'Redirect response carried no usable Location header.' } };
        if (hops >= config.maxRedirects) {
          envelope.completeness = 'redirect_not_followed';
          envelope.ok = true;
          envelope.redirect_location = next;
          return { envelope };
        }
        hops += 1;
        current = next;
        continue;
      }

      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      envelope.content_type = contentType;
      envelope.content_length = response.body.length;

      if (!TEXT_TYPES.test(contentType)) {
        return { envelope, error: { status: 415, code: 'UNSUPPORTED_CONTENT_TYPE', message: `Content type "${contentType || 'unknown'}" is not a supported official-document format.` } };
      }
      if (!response.body.length) {
        envelope.completeness = 'empty';
        envelope.ok = true;
        return { envelope };
      }

      const { createHash } = await import('node:crypto');
      envelope.content_sha256 = createHash('sha256').update(response.body).digest('hex');
      envelope.content_base64 = response.body.toString('base64');
      envelope.completeness = BINARY_OK.test(contentType) || response.body.length >= maxBytes ? 'complete_bounded' : 'complete';
      envelope.ok = true;
      return { envelope };
    }
  };
}