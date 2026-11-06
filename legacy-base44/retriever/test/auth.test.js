import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_HEADERS, createReplayStore, signRequest, verifyRequest } from '../src/auth.js';

const secret = 'test-only-shared-secret';
const bodyText = JSON.stringify({ url: 'https://gamblingcommission.gov.uk/publications' });
const now = 1_800_000_000_000;
const nonce = () => `nonce${Math.random().toString(36).slice(2, 12)}`;

const signed = (overrides = {}) => {
  const timestamp = String(overrides.timestamp ?? now);
  const n = overrides.nonce ?? nonce();
  return {
    bodyText,
    headers: {
      [AUTH_HEADERS.timestamp]: timestamp,
      [AUTH_HEADERS.nonce]: n,
      [AUTH_HEADERS.signature]: signRequest({ secret, timestamp, nonce: n, bodyText }),
    },
  };
};

test('a correctly signed request is accepted', () => {
  const { headers } = signed();
  assert.equal(verifyRequest({ headers, bodyText, secret, replayStore: createReplayStore(), now }).ok, true);
});

test('missing, unsigned or malformed headers are refused', () => {
  const store = createReplayStore();
  assert.equal(verifyRequest({ headers: {}, bodyText, secret, replayStore: store, now }).code, 'AUTH_MISSING');
  const { headers } = signed();
  assert.equal(verifyRequest({ headers: { ...headers, [AUTH_HEADERS.signature]: 'not-hex' }, bodyText, secret, replayStore: store, now }).code, 'AUTH_INVALID');
});

test('a tampered body or a different secret is refused', () => {
  const { headers } = signed();
  const store = createReplayStore();
  assert.equal(verifyRequest({ headers, bodyText: JSON.stringify({ url: 'https://evil.example' }), secret, replayStore: store, now }).code, 'AUTH_INVALID');
  assert.equal(verifyRequest({ headers, bodyText, secret: 'other-secret', replayStore: store, now }).code, 'AUTH_INVALID');
});

test('a stale timestamp outside the skew window is refused', () => {
  const { headers } = signed({ timestamp: String(now - 600_000) });
  assert.equal(verifyRequest({ headers, bodyText, secret, replayStore: createReplayStore(), now }).code, 'AUTH_STALE');
});

test('replaying a nonce is refused', () => {
  const store = createReplayStore();
  const { headers } = signed();
  assert.equal(verifyRequest({ headers, bodyText, secret, replayStore: store, now }).ok, true);
  assert.equal(verifyRequest({ headers, bodyText, secret, replayStore: store, now }).code, 'AUTH_REPLAY');
});

test('an unset secret closes the service instead of allowing traffic', () => {
  const { headers } = signed();
  const result = verifyRequest({ headers, bodyText, secret: '', replayStore: createReplayStore(), now });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, 'AUTH_NOT_CONFIGURED');
});