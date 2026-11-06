// Configuration is read from the environment only. Nothing here can be set from a request.
const n = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function loadConfig(env = process.env) {
  return {
    port: n(env.PORT, 8443),
    sharedSecret: String(env.RETRIEVER_HMAC_SECRET || ''),
    // Approved-source monitoring: exact hostnames, or ".suffix" to allow a whole official domain tree.
    approvedHosts: String(env.APPROVED_HOSTS || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    allowedPorts: String(env.ALLOWED_PORTS || '443')
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535),
    allowCandidate: env.ALLOW_CANDIDATE === 'true',
    maxBytes: n(env.MAX_RESPONSE_BYTES, 8 * 1024 * 1024),
    candidateMaxBytes: n(env.CANDIDATE_MAX_BYTES, 2 * 1024 * 1024),
    timeoutMs: n(env.REQUEST_TIMEOUT_MS, 12000),
    maxRedirects: n(env.MAX_REDIRECTS, 0), // 0 = never follow; the caller decides each hop
    authSkewSeconds: n(env.AUTH_CLOCK_SKEW_SECONDS, 300),
    maxRequestBodyBytes: n(env.MAX_REQUEST_BODY_BYTES, 16384),
    userAgent: String(env.RETRIEVER_USER_AGENT || 'StakelogicComplianceRetriever/1.0'),
    accept: String(env.RETRIEVER_ACCEPT || 'text/html,application/xhtml+xml,application/pdf,text/plain,application/xml;q=0.9,*/*;q=0.5'),
  };
}

export const CONTRACT_VERSION = '1.0';