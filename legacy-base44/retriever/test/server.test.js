// HTTP surface tests: authentication, request validation, routing and health.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { AUTH_HEADERS, signRequest } from '../src/auth.js';

const secret = 'test-only-shared-secret';
let server;
let base;

test.before(async () => {
  server = createServer({
    config: {
      port: 0,
      sharedSecret: secret,
      approvedHosts: ['localhost'],
      allowedPorts: [443],
      allowCandidate: false,
      maxBytes: 1024,
      candidateMaxBytes: 512,
      timeoutMs: 500,
      maxRedirects: 0,
      authSkewSeconds: 300,
      maxRequestBodyBytes: 2048,
      userAgent: 'test',
      accept: 'text/html',
    },
    resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const post = async (path, body, { signed = true } = {}) => {
  const bodyText = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = Math.random().toString(36).slice(2, 12);
  const headers = { 'Content-Type': 'application/json' };
  if (signed) {
    headers[AUTH_HEADERS.timestamp] = timestamp;
    headers[AUTH_HEADERS.nonce] = nonce;
    headers[AUTH_HEADERS.signature] = signRequest({ secret, timestamp, nonce, bodyText });
  }
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: bodyText });
  return { status: response.status, body: await response.json() };
};

test('health check answers without credentials and reveals no configuration values', async () => {
  const response = await fetch(`${base}/healthz`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.contract_version, '1.0');
  assert.equal(JSON.stringify(body).includes(secret), false);
});

test('an unsigned retrieval request is refused', async () => {
  const { status, body } = await post('/retrieve', { url: 'https://localhost/doc.html' }, { signed: false });
  assert.equal(status, 401);
  assert.equal(body.code, 'AUTH_MISSING');
});

test('a signed request with an unapproved destination is refused with a structured error', async () => {
  const { status, body } = await post('/retrieve', { url: 'https://unapproved.example/doc.html' });
  assert.equal(status, 403);
  assert.equal(body.error.code, 'HOST_NOT_APPROVED');
  assert.equal(body.approval_effect, 'none');
});

test('fields outside the collection inputs are rejected', async () => {
  const { status, body } = await post('/retrieve', { url: 'https://localhost/doc.html', requirements: [{ id: 'R-1' }], user_records: [] });
  assert.equal(status, 400);
  assert.equal(body.code, 'UNEXPECTED_FIELDS');
  assert.match(body.message, /requirements, user_records/);
});

test('candidate mode is refused when disabled on the service', async () => {
  const { status, body } = await post('/retrieve', { url: 'https://localhost/doc.html', mode: 'candidate' });
  assert.equal(status, 403);
  assert.equal(body.error.code, 'CANDIDATE_MODE_DISABLED');
});

test('unknown paths and wrong methods are not proxied', async () => {
  const notFound = await fetch(`${base}/proxy?url=https://example.com`);
  assert.equal(notFound.status, 404);
  const wrongMethod = await fetch(`${base}/retrieve`, { method: 'GET' });
  assert.equal(wrongMethod.status, 405);
  const connect = await fetch(`${base}/retrieve`, { method: 'DELETE' });
  assert.equal(connect.status, 405);
});

test('oversized request bodies are refused', async () => {
  const { status, body } = await post('/retrieve', { url: 'https://localhost/doc.html', source_ref: 'x'.repeat(4096) });
  assert.equal(status, 413);
  assert.equal(body.code, 'REQUEST_TOO_LARGE');
});