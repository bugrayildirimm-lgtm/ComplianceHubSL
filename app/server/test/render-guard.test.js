import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inspectFetch, clearRobotsCache, renderGuard, MAX_RENDER_REQUESTS } from '../shared/inspectFetch.ts';

// Tests for the FETCH_RENDER browser policy. No real internet: a mocked browser, plus (when Chromium is installed)
// a real Chromium talking only to servers on 127.0.0.1.

const PUBLIC = '93.184.216.34';

test('guard: the resolver rules pin the page host to the vetted address and make every other name unresolvable', () => {
  const g = renderGuard('regulator.test', PUBLIC);
  assert.deepEqual(g.args, [`--host-resolver-rules=MAP regulator.test ${PUBLIC}, MAP * ~NOTFOUND`]);
  assert.match(renderGuard('regulator.test', '2606:4700::1111').resolverRules, /MAP regulator\.test \[2606:4700::1111],/);
});

test('guard: only the page host and only document/script/stylesheet/xhr/fetch are allowed', () => {
  const g = renderGuard('regulator.test', PUBLIC);
  for (const t of ['document', 'script', 'stylesheet', 'xhr', 'fetch']) assert.equal(g.decide(`https://regulator.test/a-${t}`, t).allow, true, t);
  for (const t of ['image', 'media', 'font', 'websocket', 'eventsource', 'manifest', 'other', 'ping']) {
    const d = g.decide(`https://regulator.test/x-${t}`, t);
    assert.equal(d.allow, false, t); assert.equal(d.why, `type ${t}`);
  }
  for (const u of ['https://other.test/a.js', 'https://cdn.regulator.test/a.js', 'https://fonts.gstatic.com/f.woff2']) assert.deepEqual(g.decide(u, 'script'), { allow: false, why: 'other host' }, u);
  assert.equal(g.decide('wss://regulator.test/socket', 'websocket').allow, false);
  for (const u of ['http://127.0.0.1/', 'http://10.0.0.5/a.js', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd', 'https://regulator.test:8443/a.js']) {
    assert.equal(g.decide(u, 'script').allow, false, u);
  }
});

test('guard: at most 40 allowed requests, then everything is aborted', () => {
  assert.equal(MAX_RENDER_REQUESTS, 40);
  const g = renderGuard('regulator.test', PUBLIC);
  const results = Array.from({ length: 45 }, (_, i) => g.decide(`https://regulator.test/r${i}.js`, 'script'));
  assert.equal(results.filter((r) => r.allow).length, 40);
  assert.deepEqual(results[40], { allow: false, why: 'request cap' });
  // refused requests do not use up the allowance
  const h = renderGuard('regulator.test', PUBLIC, { maxRequests: 2 });
  h.decide('https://other.test/a.js', 'script'); h.decide('https://regulator.test/i.png', 'image');
  assert.equal(h.decide('https://regulator.test/1.js', 'script').allow, true);
  assert.equal(h.decide('https://regulator.test/2.js', 'script').allow, true);
  assert.equal(h.decide('https://regulator.test/3.js', 'script').allow, false);
});

// ---- mocked browser, driven through inspectFetch ----
let port; let server; let hits = [];
const SHELL = '<html><head><title>App</title><script>render()</script></head><body><div id="root"></div></body></html>';
const startServer = async () => {
  server = http.createServer((req, res) => {
    hits.push({ host: String(req.headers.host).split(':')[0], path: req.url });
    if (req.url === '/robots.txt') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(SHELL);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
};

test('mocked browser: launched with pinned host, hostile requests are aborted and reported, rendered text is kept', async () => {
  await startServer(); hits = []; clearRobotsCache();
  try {
    const launches = []; const decisions = [];
    const requests = [
      ['https://regulator.test/app.js', 'script'], ['https://regulator.test/api/law', 'xhr'], ['https://regulator.test/logo.png', 'image'],
      ['https://regulator.test/f.woff2', 'font'], ['https://track.example/p.js', 'script'], ['http://10.0.0.5/admin', 'xhr'],
      ['http://169.254.169.254/latest/meta-data/', 'fetch'], ['wss://regulator.test/live', 'websocket'],
    ];
    const chromium = { launch: async (opts) => {
      launches.push(opts);
      return { close: async () => {}, newContext: async (copts) => {
        launches.push({ context: copts });
        let handler;
        return { route: async (_p, h) => { handler = h; }, newPage: async () => ({
          goto: async () => { for (const [url, type] of requests) { await handler({ request: () => ({ url: () => url, resourceType: () => type }), abort: async () => decisions.push([url, 'abort']), continue: async () => decisions.push([url, 'continue']) }); } },
          waitForTimeout: async () => {}, evaluate: async () => 'Gambling Act 2025. Operators must hold a licence issued by the Commission. '.repeat(3), title: async () => 'Rendered Act',
        }) };
      } };
    } };
    const deps = { resolve: async () => [{ address: PUBLIC, family: 4 }], connect: () => ({ address: '127.0.0.1', port }), minGapMs: 0, chromium };
    const cfg = { enabled: true, ready: true, contact: 'c@example.test', timeoutMs: 2000, maxBytes: 100000, maxRedirects: 5, render: true, minGapMs: 0, userAgent: 'StakelogicComplianceHub/1.0 (+c@example.test)' };
    const r = await inspectFetch('http://regulator.test/shell.html', { allowedHosts: new Set(['regulator.test']), deps, config: cfg });
    assert.equal(r.ok, true); assert.equal(r.rendered, true); assert.equal(r.title, 'App');
    assert.match(r.text, /Operators must hold a licence/);
    assert.match(r.gap, /browser rendering/); assert.match(r.gap, /6 subresource request\(s\) blocked/);
    assert.ok(launches[0].args.includes(`--host-resolver-rules=MAP regulator.test ${PUBLIC}, MAP * ~NOTFOUND`), 'launched with the pinned address');
    assert.equal(launches[1].context.acceptDownloads, false); assert.equal(launches[1].context.serviceWorkers, 'block');
    assert.deepEqual(decisions.filter((d) => d[1] === 'continue').map((d) => d[0]), ['https://regulator.test/app.js', 'https://regulator.test/api/law']);
    assert.equal(decisions.filter((d) => d[1] === 'abort').length, 6);
  } finally { server.close(); }
});

test('mocked browser: a browser failure is reported as a labelled gap, never as invented text', async () => {
  await startServer(); hits = []; clearRobotsCache();
  try {
    const chromium = { launch: async () => { throw new Error('browser missing'); } };
    const deps = { resolve: async () => [{ address: PUBLIC, family: 4 }], connect: () => ({ address: '127.0.0.1', port }), minGapMs: 0, chromium };
    const cfg = { enabled: true, ready: true, contact: 'c@example.test', timeoutMs: 2000, maxBytes: 100000, maxRedirects: 5, render: true, minGapMs: 0, userAgent: 'x' };
    const r = await inspectFetch('http://regulator.test/shell.html', { allowedHosts: new Set(['regulator.test']), deps, config: cfg });
    assert.equal(r.ok, false); assert.equal(r.code, 'NO_READABLE_TEXT'); assert.equal(r.text, '');
    assert.match(r.gap, /Rendering: failed \(browser missing\)/);
  } finally { server.close(); }
});

// ---- real Chromium, local servers only (skipped when Playwright or its browser is not installed) ----
let chromiumLib = null;
try { chromiumLib = (await import('playwright')).chromium; const b = await chromiumLib.launch({ headless: true }); await b.close(); } catch { chromiumLib = null; }

test('real Chromium: names other than the page host cannot be resolved (redirect, subresource, WebSocket)', { skip: !chromiumLib && 'Playwright/Chromium not installed' }, async () => {
  const seen = [];
  const mk = () => http.createServer((req, res) => {
    seen.push(String(req.headers.host).split(':')[0] + req.url);
    if (req.url === '/redir') { res.writeHead(302, { location: `http://other.localhost:${req.socket.localPort}/secret` }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><body>ok<script>fetch('http://other.localhost:${req.socket.localPort}/xhr').catch(()=>{});try{new WebSocket('ws://other.localhost:${req.socket.localPort}/ws')}catch(e){}</script><img src="http://other.localhost:${req.socket.localPort}/img"></body></html>`);
  });
  const a = mk();
  await new Promise((r) => a.listen(0, '127.0.0.1', r));
  const p = a.address().port;
  const g = renderGuard('pinned.test', '127.0.0.1');
  const browser = await chromiumLib.launch({ headless: true, args: g.args });
  try {
    const page = await (await browser.newContext()).newPage();
    // 1. the pinned host works at all (names map to the vetted address)
    await page.goto(`http://pinned.test:${p}/page`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    assert.ok(seen.includes('pinned.test/page'));
    // 2. a redirect to another host cannot resolve
    await assert.rejects(page.goto(`http://pinned.test:${p}/redir`, { waitUntil: 'load' }), /ERR_NAME_NOT_RESOLVED|ERR_/);
    // 3. nothing addressed to any other name ever reached a server (the page's fetch, image and WebSocket included)
    assert.deepEqual(seen.filter((s) => !s.startsWith('pinned.test')), []);
  } finally { await browser.close(); a.close(); }
});

test('real Chromium: a redirect or request to a private/metadata IP literal cannot get out (with and without the route handler)', { skip: !chromiumLib && 'Playwright/Chromium not installed' }, async () => {
  // The internal server stands in for 10.x / 169.254.169.254. The resolver rule (MAP * ~NOTFOUND) refuses IP literals,
  // and the route handler (guard.decide) is a second layer: it refuses them because the URL policy does.
  const seen = [];
  const internal = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200); res.end('internal'); });
  await new Promise((r) => internal.listen(0, '127.0.0.1', r));
  const ip = internal.address().port;
  const a = http.createServer((req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${ip}/internal` }); res.end(); });
  await new Promise((r) => a.listen(0, '127.0.0.1', r));
  const ap = a.address().port;
  const g = renderGuard('pinned.test', '127.0.0.1');
  const browser = await chromiumLib.launch({ headless: true, args: g.args });
  try {
    const context = await browser.newContext();
    const routed = [];
    await context.route('**/*', async (route) => {
      const req = route.request(); routed.push(req.url());
      if (new URL(req.url()).hostname === 'pinned.test') return route.continue(); // test shim: the guard only allows ports 80/443
      const d = g.decide(req.url(), req.resourceType());
      return d.allow ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await assert.rejects(page.goto(`http://pinned.test:${ap}/start`, { waitUntil: 'load' }));
    await assert.rejects(page.goto(`http://127.0.0.1:${ip}/direct`, { waitUntil: 'load' }));
    assert.deepEqual(seen, [], 'the internal server received nothing');
    // Whether Chromium shows the redirect hop to the route handler is not asserted; the resolver rule holds either way.
    assert.ok(routed.length >= 1);
  } finally { await browser.close(); a.close(); internal.close(); }
});
