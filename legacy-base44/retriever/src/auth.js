// HMAC-SHA256 request authentication. The shared secret is read from the environment
// and is never logged, returned in a response, or written to a test result.
import crypto from 'node:crypto';

export const AUTH_HEADERS = {
  timestamp: 'x-retriever-timestamp',
  nonce: 'x-retriever-nonce',
  signature: 'x-retriever-signature',
};

export function bodyDigest(bodyText) {
  return crypto.createHash('sha256').update(bodyText || '', 'utf8').digest('hex');
}

export function signRequest({ secret, timestamp, nonce, bodyText }) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${bodyDigest(bodyText)}`)
    .digest('hex');
}

export function createReplayStore() {
  const seen = new Map();
  return {
    has(nonce) {
      const now = Date.now();
      for (const [key, expires] of seen) if (expires <= now) seen.delete(key);
      return seen.has(nonce);
    },
    add(nonce, ttlSeconds) {
      seen.set(nonce, Date.now() + ttlSeconds * 1000);
    },
  };
}

export function verifyRequest({ headers, bodyText, secret, skewSeconds = 300, replayStore, now = Date.now() }) {
  if (!secret) return { ok: false, status: 503, code: 'AUTH_NOT_CONFIGURED', message: 'Retriever authentication secret is not configured.' };
  const timestamp = String(headers[AUTH_HEADERS.timestamp] || '');
  const nonce = String(headers[AUTH_HEADERS.nonce] || '');
  const signature = String(headers[AUTH_HEADERS.signature] || '');
  if (!timestamp || !nonce || !signature) return { ok: false, status: 401, code: 'AUTH_MISSING', message: 'Signed request headers are required.' };
  if (!/^[a-f0-9]{64}$/i.test(signature)) return { ok: false, status: 401, code: 'AUTH_INVALID', message: 'Signature format is invalid.' };
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) return { ok: false, status: 401, code: 'AUTH_INVALID', message: 'Nonce format is invalid.' };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > skewSeconds * 1000) {
    return { ok: false, status: 401, code: 'AUTH_STALE', message: 'Request timestamp is outside the permitted window.' };
  }
  if (replayStore?.has(nonce)) return { ok: false, status: 401, code: 'AUTH_REPLAY', message: 'Request nonce has already been used.' };

  const expected = signRequest({ secret, timestamp, nonce, bodyText });
  const given = Buffer.from(signature, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { ok: false, status: 401, code: 'AUTH_INVALID', message: 'Signature does not match the request.' };
  }
  replayStore?.add(nonce, skewSeconds * 2);
  return { ok: true };
}