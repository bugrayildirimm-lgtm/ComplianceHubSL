import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { ensureTables, entityStore } from '../entities.js';
import { init, createApp } from '../index.js';
import { directFetchConfig, FETCH_MAINTENANCE, outboundDecision } from '../shared/protectedFetch.ts';
import { inspectFetch, inspectSource, clearRobotsCache, allowedHostsFromSources, addressVerdict, parseRobots, robotsAllows } from '../shared/inspectFetch.ts';

// A local server stands in for the internet. Hostnames are fake; the injected resolver says they are public and
// the injected connector sends the (pinned) connection to the local server. No real network is used.
let local; let port; let hits = []; let live = 0; let maxLive = 0;
const PAGE = `<html><head><title>Gambling Act</title><style>.x{}</style><script>var hidden = 1;</script></head><body><nav>menu</nav><h1>Gambling Act</h1><p>${'Operators must hold a licence issued by the Commission. '.repeat(8)}</p></body></html>`;

// Minimal one-page PDF with real text, offsets computed so the cross-reference table is valid.
function makePdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = text ? `BT /F1 12 Tf 72 700 Td (${text}) Tj ET` : '';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const PDF_SENTENCE = 'The operator shall keep records for five years.';

before(async () => {
  process.env.DATA_DIR = 'memory';
  await ensureTables();
  local = http.createServer((req, res) => {
    const host = String(req.headers.host).split(':')[0];
    hits.push({ host, path: req.url, ua: req.headers['user-agent'], enc: req.headers['accept-encoding'] });
    live++; maxLive = Math.max(maxLive, live); res.on('close', () => { live--; });
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { 'content-type': type, ...extra }); res.end(body); };
    const key = `${host}${req.url}`;
    if (req.url === '/robots.txt') {
      if (host === 'robots-block.test') return send(200, 'text/plain', 'User-agent: *\nDisallow: /private\nAllow: /private/open\n');
      if (host === 'robots-5xx.test') return send(503, 'text/plain', 'down');
      return send(404, 'text/plain', 'none');
    }
    if (key.endsWith('/page.html') || req.url === '/private/open') return send(200, 'text/html; charset=utf-8', PAGE);
    if (req.url === '/private/secret') return send(200, 'text/html', PAGE);
    if (req.url === '/big') return send(200, 'text/plain', 'x'.repeat(5000));
    if (req.url === '/hang') return; // never answers
    if (req.url === '/image') return send(200, 'image/png', Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]));
    if (req.url === '/doc.pdf') return send(200, 'application/pdf', makePdf(PDF_SENTENCE));
    if (req.url === '/blank.pdf') return send(200, 'application/pdf', makePdf(''));
    if (req.url === '/shell.html') return send(200, 'text/html', '<html><head><title>App</title><script>render()</script></head><body><div id="root"></div></body></html>');
    if (req.url === '/to-evil') return send(302, 'text/plain', '', { location: 'http://evil.test/page.html' });
    if (req.url === '/to-private') return send(302, 'text/plain', '', { location: 'http://10.0.0.5/page.html' });
    if (req.url === '/to-metadata') return send(302, 'text/plain', '', { location: 'http://169.254.169.254/latest/meta-data/' });
    if (req.url === '/to-www') return send(302, 'text/plain', '', { location: 'http://www.regulator.test/page.html' });
    if (req.url === '/loop') return send(302, 'text/plain', '', { location: '/loop' });
    if (req.url === '/gone') return send(404, 'text/html', 'not found');
    return send(200, 'text/html', PAGE);
  });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  port = local.address().port;
});
after(() => local.close());

const PUBLIC = '93.184.216.34';
const hostMap = (extra = {}) => ({ 'regulator.test': PUBLIC, 'www.regulator.test': PUBLIC, 'evil.test': PUBLIC, 'robots-block.test': PUBLIC, 'robots-5xx.test': PUBLIC, ...extra });
const mkDeps = (map = hostMap(), extra = {}) => {
  const connections = []; const resolved = [];
  return {
    connections, resolved,
    resolve: async (h) => { resolved.push(h); const a = map[h]; if (!a) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); return (Array.isArray(a) ? a : [a]).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })); },
    connect: ({ address }) => { connections.push(address); return { address: '127.0.0.1', port }; },
    minGapMs: 0,
    ...extra,
  };
};
const CFG = { enabled: true, ready: true, contact: 'compliance@example.test', timeoutMs: 2000, maxBytes: 100000, maxRedirects: 5, render: false, minGapMs: 0, userAgent: 'StakelogicComplianceHub/1.0 (+compliance@example.test)' };
const run = (url, { hosts = ['regulator.test', 'www.regulator.test', 'robots-block.test', 'robots-5xx.test'], deps = mkDeps(), config = CFG } = {}) =>
  inspectFetch(url, { allowedHosts: new Set(hosts), deps, config });
const reset = () => { hits = []; maxLive = 0; clearRobotsCache(); };

test('off by default: configuration, the fetcher and the old guard all stay paused', async () => {
  assert.equal(directFetchConfig({}).enabled, false);
  assert.equal(directFetchConfig({ DIRECT_FETCH_ENABLED: 'true' }).ready, false, 'enabled without FETCH_CONTACT is not ready');
  assert.equal(directFetchConfig({ DIRECT_FETCH_ENABLED: 'true', FETCH_CONTACT: 'has spaces' }).ready, false);
  const c = directFetchConfig({ DIRECT_FETCH_ENABLED: 'true', FETCH_CONTACT: 'mailto-free@example.test' });
  assert.deepEqual([c.ready, c.timeoutMs, c.maxBytes, c.maxRedirects, c.render], [true, 20000, 10485760, 5, false]);
  assert.equal(c.userAgent, 'StakelogicComplianceHub/1.0 (+mailto-free@example.test)');
  reset();
  const r = await run('http://regulator.test/page.html', { config: { ...CFG, enabled: false, ready: false } });
  assert.equal(r.ok, false); assert.equal(r.code, 'DISABLED'); assert.equal(hits.length, 0);
  assert.equal(FETCH_MAINTENANCE.paused, true);
  assert.equal(outboundDecision('https://regulator.test/').allowed, false);
});

test('accepts an allowlisted HTML page and records the evidence fields', async () => {
  reset();
  const r = await run('http://regulator.test/page.html');
  assert.equal(r.ok, true); assert.equal(r.status, 200); assert.equal(r.kind, 'html');
  assert.equal(r.content_type, 'text/html'); assert.equal(r.title, 'Gambling Act');
  assert.match(r.text, /Operators must hold a licence issued by the Commission\./);
  assert.ok(!/hidden|menu/.test(r.text), 'script, style and nav are not visible text');
  assert.equal(r.content_hash, crypto.createHash('sha256').update(PAGE).digest('hex'));
  assert.equal(r.bytes, Buffer.byteLength(PAGE));
  assert.match(r.retrieved_at, /^\d{4}-\d\d-\d\dT/);
  const page = hits.find((h) => h.path === '/page.html');
  assert.equal(page.ua, 'StakelogicComplianceHub/1.0 (+compliance@example.test)');
  assert.equal(page.enc, 'identity');
});

test('accepts a small PDF and extracts its text verbatim', async () => {
  const r = await run('http://regulator.test/doc.pdf');
  assert.equal(r.ok, true); assert.equal(r.kind, 'pdf'); assert.equal(r.content_type, 'application/pdf');
  assert.ok(r.text.includes(PDF_SENTENCE), `got: ${JSON.stringify(r.text)}`);
});

test('a PDF with no extractable text is a labelled gap, not invented text', async () => {
  const r = await run('http://regulator.test/blank.pdf');
  assert.equal(r.ok, false); assert.equal(r.code, 'PDF_EXTRACTION_FAILED'); assert.equal(r.text, '');
  assert.match(r.gap, /no extractable text/);
});

test('a script-rendered page with no readable text is recorded as a labelled gap', async () => {
  const r = await run('http://regulator.test/shell.html');
  assert.equal(r.ok, false); assert.equal(r.code, 'NO_READABLE_TEXT'); assert.equal(r.text, '');
  assert.match(r.gap, /^no readable text retrieved/);
});

test('refuses a host that is not the host of any Source', async () => {
  reset();
  const r = await run('http://unknown.test/page.html');
  assert.equal(r.code, 'NOT_ALLOWLISTED'); assert.equal(hits.length, 0);
});

test('refuses private, loopback, link-local and metadata addresses (literal and via DNS)', async () => {
  reset();
  for (const url of ['http://127.0.0.1/page.html', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[fd00:ec2::254]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/']) {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    const r = await run(url, { hosts: [host, '127.0.0.1'] });
    assert.equal(r.ok, false, url); assert.equal(r.code, 'BLOCKED_ADDRESS', `${url} -> ${r.code}`);
  }
  const viaDns = await run('http://regulator.test/page.html', { deps: mkDeps(hostMap({ 'regulator.test': '10.0.0.5' })) });
  assert.equal(viaDns.code, 'BLOCKED_ADDRESS');
  const mixed = await run('http://regulator.test/page.html', { deps: mkDeps(hostMap({ 'regulator.test': [PUBLIC, '127.0.0.1'] })) });
  assert.equal(mixed.code, 'BLOCKED_ADDRESS', 'one private answer among public ones refuses the host');
  const v6 = await run('http://regulator.test/page.html', { deps: mkDeps(hostMap({ 'regulator.test': 'fd00:ec2::254' })) });
  assert.equal(v6.code, 'BLOCKED_ADDRESS');
  assert.equal(hits.length, 0, 'nothing reached the server');
});

test('refuses non-http schemes, credentials and unusual ports', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://regulator.test/', 'http://user:pw@regulator.test/', 'http://regulator.test:8080/']) {
    assert.equal((await run(url)).code, 'BAD_URL', url);
  }
});

test('refuses a redirect to a host that is not allowed, and to private addresses', async () => {
  reset();
  assert.equal((await run('http://regulator.test/to-evil')).code, 'REDIRECT_REFUSED');
  assert.equal((await run('http://regulator.test/to-private')).code, 'BLOCKED_ADDRESS');
  assert.equal((await run('http://regulator.test/to-metadata')).code, 'BLOCKED_ADDRESS');
  assert.ok(!hits.some((h) => h.host === 'evil.test' && h.path === '/page.html'), 'the disallowed target was never requested');
  assert.equal((await run('http://regulator.test/loop', { config: { ...CFG, maxRedirects: 3 } })).code, 'TOO_MANY_REDIRECTS');
});

test('allows a redirect inside the same registrable domain', async () => {
  const r = await run('http://regulator.test/to-www', { hosts: ['regulator.test'] }); // www is not itself a Source host
  assert.equal(r.ok, true); assert.equal(r.final_url, 'http://www.regulator.test/page.html'); assert.deepEqual(r.redirects, ['http://www.regulator.test/page.html']);
});

test('DNS rebinding: the connection goes to the address that was checked', async () => {
  // The hostname answers with a public address first and a private one afterwards.
  let calls = 0;
  const deps = mkDeps(hostMap(), { resolve: async () => [{ address: calls++ === 0 ? PUBLIC : '127.0.0.1', family: 4 }] });
  deps.connect = ({ address }) => { deps.connections.push(address); return { address: '127.0.0.1', port }; };
  reset();
  // robots.txt is request one (public answer); the page is request two and sees the private answer: refused.
  const refused = await run('http://regulator.test/page.html', { deps });
  assert.equal(refused.code, 'BLOCKED_ADDRESS');
  assert.ok(deps.connections.every((a) => a === PUBLIC), `connected to ${deps.connections}`);
  assert.ok(!hits.some((h) => h.path === '/page.html'));
  // Each request resolves once and connects to exactly that answer.
  const pinned = mkDeps();
  const ok = await run('http://regulator.test/page.html', { deps: pinned });
  assert.equal(ok.ok, true);
  assert.deepEqual(new Set(pinned.connections), new Set([PUBLIC]));
  assert.equal(pinned.resolved.length, pinned.connections.length, 'one lookup per request, never re-resolved at connect time');
});

test('refuses an oversize body and an oversize declared length', async () => {
  const r = await run('http://regulator.test/big', { config: { ...CFG, maxBytes: 1000 } });
  assert.equal(r.code, 'TOO_LARGE'); assert.equal(r.text, '');
  const r2 = await run('http://regulator.test/big', { config: { ...CFG, maxBytes: 100000 } });
  assert.equal(r2.ok, true);
});

test('times out on a server that never answers', async () => {
  const started = Date.now();
  const r = await run('http://regulator.test/hang', { config: { ...CFG, timeoutMs: 300 } });
  assert.equal(r.code, 'TIMEOUT'); assert.ok(Date.now() - started < 3000);
});

test('refuses non-text content', async () => {
  const r = await run('http://regulator.test/image');
  assert.equal(r.ok, false); assert.equal(r.code, 'UNSUPPORTED_CONTENT_TYPE'); assert.equal(r.text, '');
});

test('honours robots.txt: disallowed paths are never fetched, Allow can override, 404 allows, 5xx refuses', async () => {
  reset();
  const blocked = await run('http://robots-block.test/private/secret');
  assert.equal(blocked.ok, false); assert.equal(blocked.code, 'ROBOTS_DISALLOWED'); assert.match(blocked.gap, /^blocked by robots\.txt/);
  assert.ok(!hits.some((h) => h.path === '/private/secret'));
  assert.equal((await run('http://robots-block.test/private/open')).ok, true, 'the longer Allow rule wins');
  assert.equal((await run('http://regulator.test/page.html')).ok, true, 'no robots.txt (404) means allowed');
  const down = await run('http://robots-5xx.test/page.html');
  assert.equal(down.code, 'ROBOTS_UNAVAILABLE');
  assert.ok(!hits.some((h) => h.host === 'robots-5xx.test' && h.path === '/page.html'));
  const g = parseRobots('User-agent: *\nDisallow: /a*b$\nDisallow:\n');
  assert.equal(robotsAllows(g, '/xxab'), true); assert.equal(robotsAllows(g, '/a1b'), false);
});

test('politeness: one request per host at a time and a minimum gap between requests', async () => {
  reset();
  let clock = 1_000_000; const sleeps = [];
  const deps = mkDeps(hostMap({ 'polite.test': PUBLIC }), { minGapMs: undefined, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  const cfg = { ...CFG, minGapMs: 2000 };
  const [a, b] = await Promise.all([run('http://polite.test/page.html', { deps, hosts: ['polite.test'], config: cfg }), run('http://polite.test/page.html?second=1', { deps, hosts: ['polite.test'], config: cfg })]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(maxLive, 1, 'never two requests to the same host at once');
  assert.ok(sleeps.length >= 1 && sleeps.every((ms) => ms > 0 && ms <= 2000));
  assert.ok(sleeps.reduce((x, y) => x + y, 0) >= 2000, 'at least 2 s waited between requests to the same host');
});

test('address classification covers the reserved ranges', () => {
  for (const ip of ['0.1.2.3', '100.64.0.1', '192.0.0.8', '198.18.0.1', '203.0.113.9', '240.0.0.1', '255.255.255.255', 'fe80::1', 'fec0::1', 'ff02::1', '::', '2001::1', '2001:db8::5', '64:ff9b::a00:1']) assert.equal(addressVerdict(ip).public, false, ip);
  for (const ip of ['1.1.1.1', '8.8.4.4', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(addressVerdict(ip).public, true, ip);
});

// ---- recording on the Source: evidence only, no alerts, no status changes ----
test('inspectSource stores evidence only: no alert, notification or status change; known failures are not retried', async () => {
  const E = { Source: entityStore('Source') };
  const count = async (n) => entityStore(n).count({});
  const mk = (over) => entityStore('Source').create({ source_id: `SRC-${crypto.randomUUID()}`, url: 'http://regulator.test/page.html', authority: 'Regulator', jurisdiction_id: 'JUR-T', verification_status: 'Awaiting source verification', health_status: 'Awaiting source verification', last_content_hash: 'baseline-hash', alert_count: 0, ...over });
  const good = await mk({});
  const pdfSource = await mk({ url: 'http://regulator.test/blank.pdf' });
  const rejected = await mk({ url: 'http://regulator.test/page.html', verification_status: 'Rejected' });
  const hosts = allowedHostsFromSources(await entityStore('Source').filter({}));
  assert.ok(hosts.has('regulator.test'));
  assert.equal(allowedHostsFromSources([rejected]).size, 0, 'a Rejected source does not widen the allowlist');
  const before = { alerts: await count('RegulatoryAlert'), notes: await count('Notification') };
  reset();

  const r = await inspectSource(E, good, { allowedHosts: hosts, deps: mkDeps(), config: CFG });
  assert.equal(r.attempted, true); assert.equal(r.ok, true);
  const stored = await entityStore('Source').get(good.id);
  assert.equal(stored.verification_status, 'Awaiting source verification');
  assert.equal(stored.health_status, 'Awaiting source verification');
  assert.equal(stored.last_content_hash, 'baseline-hash', 'the collection baseline is untouched');
  assert.equal(stored.alert_count, 0);
  assert.equal(stored.retrieval_http_status, 200);
  assert.equal(stored.retrieval_content_hash, crypto.createHash('sha256').update(PAGE).digest('hex'));
  assert.equal(stored.retrieval_content_type, 'text/html');
  assert.equal(stored.retrieval_page_title, 'Gambling Act');
  assert.ok(stored.retrieval_excerpt.startsWith('Gambling Act'));
  assert.ok(stored.retrieval_excerpt.length <= 8000);
  assert.equal(stored.extraction_status, 'Complete');
  assert.equal(stored.format_gap, '');

  // A known PDF failure is stored once and then shown, not retried.
  const first = await inspectSource(E, pdfSource, { allowedHosts: hosts, deps: mkDeps(), config: CFG });
  assert.equal(first.attempted, true); assert.equal(first.code, 'PDF_EXTRACTION_FAILED');
  const requestsAfterFirst = hits.filter((h) => h.path === '/blank.pdf').length;
  const failed = await entityStore('Source').get(pdfSource.id);
  assert.equal(failed.retrieval_failure_code, 'PDF_EXTRACTION_FAILED'); assert.equal(failed.extraction_status, 'Failed');
  assert.equal(failed.retrieval_excerpt, '');
  const second = await inspectSource(E, failed, { allowedHosts: hosts, deps: mkDeps(), config: CFG });
  assert.equal(second.attempted, false); assert.match(second.limitations, /^Not retried/);
  assert.equal(hits.filter((h) => h.path === '/blank.pdf').length, requestsAfterFirst, 'no second request');
  const legacy = await inspectSource(E, { ...good, format_gap: 'PDF text unavailable. Official HTML/text alternative or AI-assisted extraction is required.', retrieval_failure_code: '' }, { allowedHosts: hosts, deps: mkDeps(), config: CFG });
  assert.equal(legacy.attempted, false, 'a legacy Base44 PDF failure is also not retried');

  const skip = await inspectSource(E, rejected, { allowedHosts: hosts, deps: mkDeps(), config: CFG });
  assert.equal(skip.attempted, false);

  assert.equal(await count('RegulatoryAlert'), before.alerts, 'no alert was raised');
  assert.equal(await count('Notification'), before.notes, 'no notification was raised');
  assert.equal((await entityStore('Source').get(pdfSource.id)).verification_status, 'Awaiting source verification');
});

// ---- through the real function: default-off, misconfigured, and the self-tests ----
let server; let base; let cookie = '';
const call = (path, opts = {}) => fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } });
test('sourceReview inspect: paused by default (503), config error when no contact, other functions stay paused', async () => {
  process.env.ADMIN_EMAIL = 'admin@example.test'; process.env.ADMIN_PASSWORD = 'correct horse battery';
  await init();
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.test', password: 'correct horse battery' }) });
    cookie = login.headers.get('set-cookie').split(';')[0];
    const admin = (await entityStore('User').filter({ email: 'admin@example.test' }))[0];
    await entityStore('TeamMember').create({ user_id: admin.id, user_email: 'admin@example.test', active: true, access_role: 'Regulatory Compliance' });
    const s = await entityStore('Source').create({ source_id: 'SRC-FN', url: 'http://regulator.test/page.html', authority: 'Regulator', verification_status: 'Awaiting source verification' });
    const inspect = () => call('/api/functions/sourceReview', { method: 'POST', body: JSON.stringify({ op: 'inspect', source_ids: [s.id] }) });
    delete process.env.DIRECT_FETCH_ENABLED; delete process.env.FETCH_CONTACT;
    const off = await inspect();
    assert.equal(off.status, 503); assert.equal((await off.json()).code, 'DIRECT_FETCH_DISABLED');
    process.env.DIRECT_FETCH_ENABLED = 'true';
    const misconfigured = await inspect();
    assert.equal(misconfigured.status, 503); assert.equal((await misconfigured.json()).code, 'DIRECT_FETCH_CONFIG_ERROR');
    // Even fully enabled and configured, nothing but sourceReview inspect may use direct retrieval.
    process.env.FETCH_CONTACT = 'compliance@example.test';
    for (const name of ['discoverSources', 'runDiscoveryBatch', 'runRequirementResearch', 'correctMarketBlock']) {
      const r = await call(`/api/functions/${name}`, { method: 'POST', body: '{}' });
      assert.equal(r.status, 503, `${name} must stay paused`);
      assert.equal((await r.json()).code, 'DIRECT_FETCH_DISABLED', name);
    }
    delete process.env.DIRECT_FETCH_ENABLED; delete process.env.FETCH_CONTACT;
    const st = await call('/api/functions/securitySelfTests', { method: 'POST', body: '{}' });
    const report = await st.json();
    assert.equal(st.status, 200, JSON.stringify(report).slice(0, 300));
    const failed = (report.cases || report.results || []).filter((c) => c.passed === false);
    assert.deepEqual(failed.map((c) => c.name), [], 'all self-test cases pass');
    assert.ok((report.cases || report.results || []).length >= 20, 'self-test cases ran');
  } finally { server.close(); }
});
