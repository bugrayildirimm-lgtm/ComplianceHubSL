// Exercises the real pinned-connection path against a local TLS server.
// Certificate verification stays ON: the fixture CA is supplied through NODE_EXTRA_CA_CERTS.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRetriever } from '../src/retrieve.js';
import { createPolicy } from '../src/policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const key = fs.readFileSync(path.join(here, 'fixtures/localhost-key.pem'));
const cert = fs.readFileSync(path.join(here, 'fixtures/localhost-cert.pem'));

let server;
let port;

test.before(async () => {
  server = https.createServer({ key, cert }, (req, res) => {
    if (req.url === '/doc.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Licence conditions</title></head><body><p>Official publication text for testing.</p></body></html>');
      return;
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('x'.repeat(4096));
      return;
    }
    if (req.url === '/pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(Buffer.from('%PDF-1.7 test payload'));
      return;
    }
    if (req.url === '/binary') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/doc.html' });
      res.end();
      return;
    }
    if (req.url === '/redirect-offhost') {
      res.writeHead(302, { Location: 'https://unapproved.example/doc.html' });
      res.end();
      return;
    }
    if (req.url === '/slow') return; // never responds
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('missing');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(() => server.close());

const config = (over = {}) => ({
  approvedHosts: ['localhost'],
  allowedPorts: [port],
  maxBytes: 1024 * 1024,
  candidateMaxBytes: 1024 * 1024,
  timeoutMs: 2000,
  maxRedirects: 0,
  userAgent: 'StakelogicComplianceRetriever/test',
  accept: 'text/html,application/pdf',
  allowCandidate: true,
  ...over,
});

const resolver = (hostname) => Promise.resolve([{ address: '127.0.0.1', family: 4, hostname }]);
const localUrl = (pathname) => `https://localhost:${port}${pathname}`;

// allowPrivateForTest exists only for this local test server; loadConfig() never sets it.
const r = (over = {}) => {
  const cfg = config(over);
  return createRetriever({
    config: cfg,
    resolver,
    policy: createPolicy({ approvedHosts: cfg.approvedHosts, allowedPorts: cfg.allowedPorts, allowPrivateForTest: true }),
  });
};

test('a permitted official document is retrieved with content and an integrity hash', async () => {
  const { envelope, error } = await r()({ url: localUrl('/doc.html'), mode: 'monitoring', source_ref: 'SRC-TEST', request_id: 'REQ-1' });
  assert.equal(envelope.ok, true, JSON.stringify(error || {}));
  assert.equal(envelope.http_status, 200);
  assert.equal(envelope.content_type.startsWith('text/html'), true);
  assert.equal(envelope.source_ref, 'SRC-TEST');
  assert.equal(envelope.request_id, 'REQ-1');
  assert.equal(envelope.publication_date, null);
  const decoded = Buffer.from(envelope.content_base64, 'base64');
  assert.equal(crypto.createHash('sha256').update(decoded).digest('hex'), envelope.content_sha256);
  assert.match(decoded.toString('utf8'), /Official publication text/);
  assert.equal(envelope.trusted_for_monitoring, true);
  assert.equal(envelope.approval_effect, 'none');
});

test('a PDF is returned as bounded binary content', async () => {
  const { envelope } = await r()({ url: localUrl('/pdf'), mode: 'monitoring' });
  assert.equal(envelope.ok, true);
  assert.match(envelope.content_type, /application\/pdf/);
  assert.match(Buffer.from(envelope.content_base64, 'base64').toString('utf8'), /^%PDF/);
});

test('an unsupported format is reported, not returned as a document', async () => {
  const { envelope, error } = await r()({ url: localUrl('/binary'), mode: 'monitoring' });
  assert.equal(envelope.ok, false);
  assert.equal(error.code, 'UNSUPPORTED_CONTENT_TYPE');
  assert.equal(error.status, 415);
});

test('a redirect is reported and not followed when redirects are disabled', async () => {
  const { envelope } = await r()({ url: localUrl('/redirect'), mode: 'monitoring' });
  assert.equal(envelope.http_status, 302);
  assert.equal(envelope.completeness, 'redirect_not_followed');
  assert.match(envelope.redirect_location, /\/doc\.html$/);
  assert.equal(envelope.content_base64, null);
});

test('redirects are followed only when bounded and the next hop stays approved', async () => {
  const limited = await r({ maxRedirects: 1 })({ url: localUrl('/redirect'), mode: 'monitoring' });
  assert.equal(limited.envelope.ok, true);
  assert.equal(limited.envelope.http_status, 200);
  assert.equal(limited.envelope.redirects.length, 1);

  const offhost = await r({ maxRedirects: 1 })({ url: localUrl('/redirect-offhost'), mode: 'monitoring' });
  assert.equal(offhost.envelope.ok, false);
  assert.equal(offhost.error.code, 'HOST_NOT_APPROVED');
});

test('response size limits fail closed', async () => {
  const { error } = await r({ maxBytes: 1024 })({ url: localUrl('/big'), mode: 'monitoring' });
  assert.equal(error.code, 'RESPONSE_TOO_LARGE');
  assert.equal(error.status, 413);
});

test('a hanging destination times out with a retryable structured error', async () => {
  const { error } = await r({ timeoutMs: 300 })({ url: localUrl('/slow'), mode: 'monitoring' });
  assert.equal(error.code, 'TIMEOUT');
  assert.equal(error.status, 504);
  assert.equal(error.retryable, true);
});

test('TLS hostname verification is enforced against the validated hostname', async () => {
  const cfg = config({ approvedHosts: ['wronghost.example'], allowedPorts: [port] });
  const retrieve = createRetriever({
    config: cfg,
    resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    policy: createPolicy({ approvedHosts: cfg.approvedHosts, allowedPorts: cfg.allowedPorts, allowPrivateForTest: true }),
  });
  const { error } = await retrieve({ url: `https://wronghost.example:${port}/doc.html`, mode: 'monitoring' });
  assert.equal(error.code, 'TLS_VALIDATION_FAILED');
});

test('candidate retrieval is untrusted and carries no approval effect', async () => {
  const { envelope } = await r({ approvedHosts: [] })({ url: localUrl('/doc.html'), mode: 'candidate' });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.mode, 'candidate');
  assert.equal(envelope.trusted_for_monitoring, false);
  assert.equal(envelope.approval_effect, 'none');
});

test('candidate mode can be switched off entirely', async () => {
  const { error } = await r({ allowCandidate: false })({ url: localUrl('/doc.html'), mode: 'candidate' });
  assert.equal(error.code, 'CANDIDATE_MODE_DISABLED');
});

test('a non-approved host is refused before any connection is attempted', async () => {
  const { error } = await r({ approvedHosts: ['gamblingcommission.gov.uk'] })({ url: localUrl('/doc.html'), mode: 'monitoring' });
  assert.equal(error.code, 'HOST_NOT_APPROVED');
});