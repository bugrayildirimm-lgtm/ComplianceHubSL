// Safe, bounded retrieval for the Source review "Retrieve sample" action (sourceReview op 'inspect') ONLY.
// Nothing else imports this: collection, discovery, research and the scheduler keep the paused behaviour in
// protectedFetch.ts. Off unless DIRECT_FETCH_ENABLED=true and FETCH_CONTACT is set (see directFetchConfig).
//
// What it enforces, on the original URL and on every redirect hop:
//  - http/https only, ports 80/443 only, no credentials in the URL
//  - the host must equal the host of an existing, non-rejected Source (redirects may also stay on the same
//    registrable domain as the starting host)
//  - the host's DNS answers must ALL be public addresses (private, loopback, link-local, metadata and reserved
//    ranges refused, IPv4 and IPv6); the connection then goes to the address that was checked, so a second DNS
//    answer cannot redirect it (DNS rebinding)
//  - robots.txt is fetched and honoured for each host; one request per host at a time, minimum 2 s apart
//  - a per-request timeout, a byte limit, a redirect limit, and text/HTML/PDF content only
// One attempt per call: no retries. Failures come back as a labelled gap (code + sentence), never as invented text.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { htmlToText } from './compliance.ts';
import { directFetchConfig } from './protectedFetch.ts';

export const EXCERPT_CHARS = 8000;     // stored on the Source (the interface-preview size used elsewhere)
const TEXT_CAP = 160000;               // longest extracted text kept in the result
const MIN_READABLE_CHARS = 160;        // below this a page counts as "no readable text"
const ROBOTS_MAX_BYTES = 512 * 1024;
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const PRODUCT = 'StakelogicComplianceHub';
// Failure codes that are never retried automatically (rule 3): the stored failure is shown instead.
export const KNOWN_FORMAT_FAILURES = ['PDF_EXTRACTION_FAILED', 'UNSUPPORTED_CONTENT_TYPE', 'TOO_LARGE'];

// ---------- addresses ----------
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4Int = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const inV4 = (n, [base, bits]) => { const size = 2 ** (32 - bits); return Math.floor(n / size) === Math.floor(v4Int(base) / size); };

function parseV6(input) {
  let a = String(input).split('%')[0].toLowerCase();
  if (a.includes('.')) {
    const cut = a.lastIndexOf(':');
    const p = a.slice(cut + 1).split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    a = `${a.slice(0, cut + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}
const inV6 = (v, base, bits) => (v >> BigInt(128 - bits)) === (parseV6(base) >> BigInt(128 - bits));
// Only global unicast 2000::/3 can be public; these carve-outs inside it are not.
const V6_BLOCKED_INSIDE_GLOBAL = [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]];

// { public: boolean, reason } for an IP literal.
export function addressVerdict(ip) {
  const family = net.isIP(String(ip));
  if (family === 4) {
    const n = v4Int(ip);
    const hit = V4_BLOCKED.find((range) => inV4(n, range));
    return hit ? { public: false, reason: `${ip} is in the non-public range ${hit[0]}/${hit[1]}` } : { public: true, reason: '' };
  }
  if (family === 6) {
    const v = parseV6(ip);
    if (v === null) return { public: false, reason: `${ip} could not be parsed` };
    // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96): judge the embedded IPv4 address.
    if (inV6(v, '::ffff:0:0', 96) || inV6(v, '64:ff9b::', 96)) {
      const low = Number(v & 0xffffffffn);
      const embedded = [low >>> 24, (low >>> 16) & 255, (low >>> 8) & 255, low & 255].join('.');
      const inner = addressVerdict(embedded);
      return inner.public ? { public: true, reason: '' } : { public: false, reason: `${ip} embeds ${inner.reason}` };
    }
    if (!inV6(v, '2000::', 3)) return { public: false, reason: `${ip} is not a global unicast IPv6 address` };
    const hit = V6_BLOCKED_INSIDE_GLOBAL.find(([base, bits]) => inV6(v, base, bits));
    return hit ? { public: false, reason: `${ip} is in the reserved range ${hit[0]}/${hit[1]}` } : { public: true, reason: '' };
  }
  return { public: false, reason: `${ip} is not an IP address` };
}

// ---------- URLs and hosts ----------
function refuse(code, reason) { return { ok: false, code, reason, gap: `${GAP_LABELS[code] || code}: ${reason}` }; }
const GAP_LABELS = {
  DISABLED: 'direct retrieval is disabled',
  CONFIG: 'direct retrieval is misconfigured',
  BAD_URL: 'URL refused',
  NOT_ALLOWLISTED: 'host not allowed',
  REDIRECT_REFUSED: 'redirect refused',
  TOO_MANY_REDIRECTS: 'too many redirects',
  BLOCKED_ADDRESS: 'non-public address refused',
  DNS_FAILED: 'host could not be resolved',
  ROBOTS_DISALLOWED: 'blocked by robots.txt',
  ROBOTS_UNAVAILABLE: 'robots.txt could not be read, so nothing was fetched',
  TIMEOUT: 'request timed out',
  NETWORK_ERROR: 'network error',
  HTTP_ERROR: 'HTTP error',
  TOO_LARGE: 'response too large',
  UNSUPPORTED_CONTENT_TYPE: 'unsupported content type',
  PDF_EXTRACTION_FAILED: 'PDF text extraction failed',
  NO_READABLE_TEXT: 'no readable text retrieved',
};

export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return refuse('BAD_URL', 'not a valid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) return refuse('BAD_URL', `scheme ${u.protocol} is not allowed (http and https only)`);
  if (u.username || u.password) return refuse('BAD_URL', 'credentials in a URL are not allowed');
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (port !== 80 && port !== 443) return refuse('BAD_URL', `port ${port} is not allowed (80 and 443 only)`);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return refuse('BAD_URL', 'no host');
  const literal = net.isIP(host) !== 0;
  if (literal) {
    const v = addressVerdict(host);
    if (!v.public) return refuse('BLOCKED_ADDRESS', v.reason);
  }
  return { ok: true, url: u, host, port, literal };
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'nic', 'gob', 'gouv', 'go', 'or', 'ne', 'gv', 'mil']);
// Approximation of the registrable domain without a public-suffix list: last two labels, or three for
// country-code domains with a common second level (gov.uk, gob.mx, co.za ...).
export function registrableDomain(host) {
  if (net.isIP(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  return tld.length === 2 && SECOND_LEVEL.has(sld) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

export function allowedHostsFromSources(sources) {
  const hosts = new Set();
  for (const s of sources || []) {
    if (!s || s.is_fixture || s.verification_status === 'Rejected') continue;
    try { hosts.add(new URL(s.url).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')); } catch { /* skip */ }
  }
  return hosts;
}

// ---------- robots.txt ----------
export function parseRobots(text) {
  const groups = [];
  let current = null; let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(); const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!current || (key !== 'allow' && key !== 'disallow')) continue;
    if (value === '') continue; // an empty Disallow allows everything; an empty Allow adds nothing
    current.rules.push({ allow: key === 'allow', path: value });
  }
  return groups;
}
const patternToRegExp = (path) => {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
};
// Most specific (longest) matching rule wins; on a tie Allow wins. A group naming our product beats "*".
export function robotsAllows(groups, pathWithQuery, product = PRODUCT) {
  const token = product.toLowerCase();
  let matching = groups.filter((g) => g.agents.includes(token));
  if (!matching.length) matching = groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const g of matching) {
    for (const rule of g.rules) {
      if (!patternToRegExp(rule.path).test(pathWithQuery)) continue;
      if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow && !best.allow)) best = rule;
    }
  }
  return !best || best.allow;
}

// ---------- politeness: one request per host at a time, minimum gap between requests ----------
const hostState = new Map();
function withHostSlot(host, gapMs, deps, fn) {
  const state = hostState.get(host) || { tail: Promise.resolve(), last: -Infinity };
  hostState.set(host, state);
  const run = state.tail.then(async () => {
    const wait = state.last + gapMs - deps.now();
    if (wait > 0) await deps.sleep(wait);
    try { return await fn(); } finally { state.last = deps.now(); }
  });
  state.tail = run.catch(() => {});
  return run;
}
const robotsCache = new Map();
export const clearRobotsCache = () => robotsCache.clear();

// ---------- transport ----------
const defaultDeps = () => ({
  resolve: async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family })),
  connect: ({ address, port }) => ({ address, port }),   // tests may redirect the pinned connection to a local server
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

function rawGet(ctx, u, address, maxBytes) {
  return new Promise((resolve, reject) => {
    const secure = u.protocol === 'https:';
    const port = u.port ? Number(u.port) : (secure ? 443 : 80);
    const target = ctx.deps.connect({ address, port, host: u.hostname });
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { finish(reject, { code: 'TIMEOUT', reason: `no complete response within ${ctx.cfg.timeoutMs} ms` }); req.destroy(); }, ctx.cfg.timeoutMs);
    const req = (secure ? https : http).request({
      host: target.address, port: target.port, method: 'GET', agent: false,
      path: `${u.pathname}${u.search}`, servername: secure && !net.isIP(ctx.hostnameFor(u)) ? ctx.hostnameFor(u) : undefined,
      headers: { Host: u.host, 'User-Agent': ctx.cfg.userAgent, Accept: 'text/html,application/pdf,text/plain,application/xml;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'identity', Connection: 'close' },
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) { finish(resolve, { status, headers: res.headers, body: Buffer.alloc(0) }); res.destroy(); return; }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { finish(reject, { code: 'TOO_LARGE', reason: `the server declares ${declared} bytes; the limit is ${maxBytes}` }); res.destroy(); req.destroy(); return; }
      const chunks = []; let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { finish(reject, { code: 'TOO_LARGE', reason: `the response is larger than the ${maxBytes}-byte limit` }); res.destroy(); req.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let body = Buffer.concat(chunks);
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (encoding === 'gzip' || encoding === 'x-gzip') body = zlib.gunzipSync(body, { maxOutputLength: maxBytes });
          else if (encoding === 'deflate') body = zlib.inflateSync(body, { maxOutputLength: maxBytes });
          else if (encoding === 'br') body = zlib.brotliDecompressSync(body, { maxOutputLength: maxBytes });
        } catch { return finish(reject, { code: 'TOO_LARGE', reason: 'the compressed response could not be expanded within the byte limit' }); }
        finish(resolve, { status, headers: res.headers, body });
      });
      res.on('error', (e) => finish(reject, { code: 'NETWORK_ERROR', reason: e.message }));
      res.on('aborted', () => finish(reject, { code: 'NETWORK_ERROR', reason: 'connection closed before the response finished' }));
    });
    req.on('error', (e) => finish(reject, { code: 'NETWORK_ERROR', reason: e.code ? `${e.code}: ${e.message}` : e.message }));
    req.end();
  });
}

// Allowlist rule for one hop (no network access).
function permit(ctx, checked, hop) {
  const { host } = checked;
  const permitted = ctx.allowed.has(host) || (hop > 0 && registrableDomain(host) === ctx.originDomain);
  if (!permitted) {
    return hop === 0
      ? refuse('NOT_ALLOWLISTED', `${host} is not the host of any Source on file`)
      : refuse('REDIRECT_REFUSED', `redirected to ${host}, which is not an allowed Source host or on ${ctx.originDomain}`);
  }
  return { ok: true };
}

// Validate one URL hop (allowlist, DNS) and return the address to connect to.
async function admit(ctx, checked, hop) {
  const allowed = permit(ctx, checked, hop);
  if (!allowed.ok) return allowed;
  const { host } = checked;
  if (checked.literal) return { ok: true, address: host };
  let answers;
  try { answers = await ctx.deps.resolve(host); } catch (e) { return refuse('DNS_FAILED', `${host}: ${e.code || e.message}`); }
  if (!answers?.length) return refuse('DNS_FAILED', `${host} has no address`);
  for (const a of answers) {
    const v = addressVerdict(a.address);
    if (!v.public) return refuse('BLOCKED_ADDRESS', `${host} resolves to a non-public address (${v.reason})`);
  }
  return { ok: true, address: answers[0].address }; // the connection is made to exactly this address
}

async function request(ctx, checked, hop, maxBytes) {
  const admitted = await admit(ctx, checked, hop);
  if (!admitted.ok) return admitted;
  try {
    const res = await withHostSlot(checked.host, ctx.cfg.minGapMs, ctx.deps, () => rawGet(ctx, checked.url, admitted.address, maxBytes));
    return { ok: true, address: admitted.address, ...res };
  } catch (e) {
    return refuse(e.code || 'NETWORK_ERROR', e.reason || e.message || 'request failed');
  }
}

async function robotsCheck(ctx, checked, hop) {
  const origin = `${checked.url.protocol}//${checked.url.host}`;
  const cached = robotsCache.get(origin);
  let groups;
  if (cached && ctx.deps.now() - cached.at < ROBOTS_TTL_MS) groups = cached.groups;
  else {
    let target = new URL('/robots.txt', origin);
    let res;
    for (let i = 0; i <= 3; i++) {
      const c = checkUrl(target.href);
      if (!c.ok) return c;
      res = await request(ctx, c, i === 0 ? hop : Math.max(hop, 1), ROBOTS_MAX_BYTES);
      if (!res.ok) return ['BLOCKED_ADDRESS', 'REDIRECT_REFUSED', 'NOT_ALLOWLISTED'].includes(res.code) ? res : refuse('ROBOTS_UNAVAILABLE', `${target.href}: ${res.reason}`);
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) { target = new URL(res.headers.location, target.href); continue; }
      break;
    }
    if (res.status >= 500 || [301, 302, 303, 307, 308].includes(res.status)) return refuse('ROBOTS_UNAVAILABLE', `${target.href} answered HTTP ${res.status}`);
    groups = res.status >= 200 && res.status < 300 ? parseRobots(res.body.toString('utf8')) : []; // 4xx: no robots.txt
    robotsCache.set(origin, { at: ctx.deps.now(), groups });
  }
  const pathWithQuery = `${checked.url.pathname}${checked.url.search}`;
  return robotsAllows(groups, pathWithQuery)
    ? { ok: true }
    : refuse('ROBOTS_DISALLOWED', `${checked.url.href} is disallowed for ${PRODUCT} by ${origin}/robots.txt; nothing was fetched`);
}

// ---------- content ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function decodeText(body, contentType) {
  const label = (contentType.match(/charset=([\w-]+)/i)?.[1] || body.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8');
  try { return new TextDecoder(label).decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}
function classify(contentType, body) {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf' || body.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (['text/html', 'application/xhtml+xml'].includes(type)) return 'html';
  if (type === 'text/plain' || type === 'text/xml' || type === 'application/xml') return 'text';
  if (!type) {
    const head = body.subarray(0, 1024);
    if (head.includes(0)) return '';
    return /<(!doctype html|html|head|body)/i.test(head.toString('latin1')) ? 'html' : 'text';
  }
  return '';
}
async function pdfText(body, timeoutMs) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const work = (async () => {
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text || '');
  })();
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`extraction took longer than ${timeoutMs} ms`)), timeoutMs); });
  try { return await Promise.race([work, limit]); } finally { clearTimeout(timer); }
}
const BLOCK_PAGE = /captcha|are you a robot|access denied|enable javascript|sign in to continue|403 forbidden/i;

// Optional Playwright fallback (FETCH_RENDER=true) for script-rendered pages. Every request the browser makes is
// checked against the same URL policy, allowlist and DNS rules; the main host is pinned with a host-resolver rule.
// Subresource hosts are checked but not pinned, and robots.txt is not re-read for subresources.
async function renderText(ctx, checked, address) {
  let browser;
  try {
    const { chromium } = await import('playwright');
    const rule = `MAP ${checked.host} ${address.includes(':') ? `[${address}]` : address}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, args: [`--host-resolver-rules=${rule}`] });
    const context = await browser.newContext({ userAgent: ctx.cfg.userAgent, acceptDownloads: false, serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const req = route.request();
      const c = checkUrl(req.url());
      if (!c.ok || ['image', 'media', 'font'].includes(req.resourceType())) return route.abort('blockedbyclient');
      if (c.host !== checked.host) {
        const a = await admit(ctx, c, 1);
        if (!a.ok) return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page = await context.newPage();
    const run = (async () => {
      await page.goto(checked.url.href, { timeout: ctx.cfg.timeoutMs, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      return { text: String(await page.evaluate(() => document.body?.innerText || '')), title: String(await page.title()) };
    })();
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('rendering timed out')), ctx.cfg.timeoutMs * 2); });
    try { return await Promise.race([run, limit]); } finally { clearTimeout(timer); }
  } catch (e) {
    return { error: String(e?.message || e) };
  } finally {
    await browser?.close().catch(() => {});
  }
}

// ---------- the fetcher ----------
// Returns a result object; never throws for an expected failure. ok=false always carries a labelled `gap`.
export async function inspectFetch(rawUrl, { allowedHosts = new Set(), deps: depOverrides = {}, config } = {}) {
  const cfg = { ...(config || directFetchConfig()) };
  const deps = { ...defaultDeps(), ...depOverrides };
  if (depOverrides.minGapMs !== undefined) cfg.minGapMs = depOverrides.minGapMs;
  const base = { requested_url: String(rawUrl), final_url: '', redirects: [], status: 0, content_type: '', bytes: 0, content_hash: '', title: '', text: '', text_chars: 0, kind: '', rendered: false, retrieved_at: '', extraction: 'Failed', code: '', gap: '' };
  const fail = (r) => ({ ...base, ok: false, code: r.code, gap: r.gap, retrieved_at: new Date(deps.now()).toISOString() });

  if (!cfg.enabled) return fail(refuse('DISABLED', 'DIRECT_FETCH_ENABLED is not true; direct retrieval is paused'));
  if (!cfg.ready) return fail(refuse('CONFIG', cfg.problem || 'FETCH_CONTACT is required'));

  const first = checkUrl(rawUrl);
  if (!first.ok) return fail(first);
  const allowed = allowedHosts instanceof Set ? allowedHosts : new Set(allowedHosts);
  const ctx = { cfg, deps, allowed, originDomain: registrableDomain(first.host), hostnameFor: (u) => u.hostname.replace(/^\[|\]$/g, '') };

  let checked = first;
  let res; let address = '';
  const redirects = [];
  for (let hop = 0; ; hop++) {
    const allowedHop = permit(ctx, checked, hop);
    if (!allowedHop.ok) return { ...fail(allowedHop), redirects, final_url: checked.url.href };
    const robots = await robotsCheck(ctx, checked, hop);
    if (!robots.ok) return { ...fail(robots), redirects, final_url: checked.url.href };
    res = await request(ctx, checked, hop, cfg.maxBytes);
    if (!res.ok) return { ...fail(res), redirects, final_url: checked.url.href };
    address = res.address;
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      if (redirects.length >= cfg.maxRedirects) return { ...fail(refuse('TOO_MANY_REDIRECTS', `more than ${cfg.maxRedirects} redirects`)), redirects, final_url: checked.url.href };
      let next;
      try { next = new URL(res.headers.location, checked.url.href).href; } catch { return { ...fail(refuse('REDIRECT_REFUSED', 'the redirect target is not a valid URL')), redirects }; }
      redirects.push(next);
      const c = checkUrl(next);
      if (!c.ok) return { ...fail(c), redirects, final_url: checked.url.href };
      checked = c;
      continue;
    }
    break;
  }

  const retrieved_at = new Date(deps.now()).toISOString();
  const contentType = String(res.headers['content-type'] || '');
  const common = { ...base, redirects, final_url: checked.url.href, status: res.status, content_type: contentType.split(';')[0].trim().toLowerCase(), bytes: res.body.length, content_hash: sha256(res.body), retrieved_at };
  if (res.status < 200 || res.status >= 300) return { ...common, ok: false, code: 'HTTP_ERROR', gap: `${GAP_LABELS.HTTP_ERROR}: HTTP ${res.status} at ${checked.url.href}` };

  const kind = classify(contentType, res.body);
  if (!kind) return { ...common, ok: false, code: 'UNSUPPORTED_CONTENT_TYPE', gap: `${GAP_LABELS.UNSUPPORTED_CONTENT_TYPE}: ${common.content_type || 'unknown'} is not HTML, plain text or PDF; an accessible official alternative is needed` };

  let text = ''; let title = '';
  if (kind === 'pdf') {
    try { text = await pdfText(res.body, cfg.timeoutMs); } catch (e) {
      return { ...common, kind, ok: false, code: 'PDF_EXTRACTION_FAILED', gap: `${GAP_LABELS.PDF_EXTRACTION_FAILED}: ${String(e?.message || e).slice(0, 200)}. Not retried; an official HTML or text alternative is needed` };
    }
    text = text.trim();
    title = decodeURIComponent(checked.url.pathname.split('/').pop() || 'PDF publication');
    if (text.length < 20) return { ...common, kind, title, ok: false, code: 'PDF_EXTRACTION_FAILED', gap: `${GAP_LABELS.PDF_EXTRACTION_FAILED}: the PDF has no extractable text (scanned or image-only?). No text was invented; not retried` };
  } else {
    const decoded = decodeText(res.body, contentType);
    text = kind === 'html' ? htmlToText(decoded) : decoded.trim();
    title = kind === 'html' ? htmlToText(decoded.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300) : '';
    let rendered = false;
    const poor = text.length < MIN_READABLE_CHARS || (text.length < 1500 && BLOCK_PAGE.test(text));
    if (poor && kind === 'html' && cfg.render) {
      const r = await renderText(ctx, checked, address);
      if (!r.error && r.text.trim().length >= MIN_READABLE_CHARS) { text = r.text.trim(); title = title || r.title.slice(0, 300); rendered = true; }
    }
    if (text.length < MIN_READABLE_CHARS || (!rendered && text.length < 1500 && BLOCK_PAGE.test(text))) {
      return { ...common, kind, title, text: '', ok: false, code: 'NO_READABLE_TEXT', gap: `${GAP_LABELS.NO_READABLE_TEXT}: the page returned ${text.length} characters of visible text (script-rendered or access-check page?). No content was reconstructed` };
    }
    return { ...common, ok: true, kind, rendered, title, text: text.slice(0, TEXT_CAP), text_chars: text.length, extraction: text.length > TEXT_CAP ? 'Partial' : 'Complete', code: '', gap: rendered ? 'Text came from browser rendering (FETCH_RENDER); it is the rendered page text, not the raw HTML.' : '' };
  }
  return { ...common, ok: true, kind, title, text: text.slice(0, TEXT_CAP), text_chars: text.length, extraction: text.length > TEXT_CAP ? 'Partial' : 'Complete', code: '', gap: '' };
}

// ---------- recording the outcome on the Source (evidence only) ----------
// Legacy Base44 format gaps that mean "known PDF/format failure".
const LEGACY_FORMAT_FAILURE = /^(PDF text unavailable|PDF extraction|Unsupported attachment format|Document exceeds the bounded)/i;
export function knownFormatFailure(source) {
  const code = source.retrieval_failure_code;
  if (code && KNOWN_FORMAT_FAILURES.includes(code)) {
    return (!source.retrieval_failure_url || source.retrieval_failure_url === source.url) ? { code, gap: source.format_gap || source.retrieval_result || code } : null;
  }
  return LEGACY_FORMAT_FAILURE.test(String(source.format_gap || '')) ? { code: 'LEGACY_FORMAT_FAILURE', gap: source.format_gap } : null;
}

// One attempt for one Source. Writes retrieval/evidence fields only: never verification_status, health_status,
// the collection baseline (last_content_hash), alert counters, or any RegulatoryAlert/Notification.
export async function inspectSource(E, source, { allowedHosts, deps, config } = {}) {
  const known = knownFormatFailure(source);
  if (known) {
    return { id: source.id, attempted: false, extraction: source.extraction_status || 'Failed', sample: source.sample_document_url || '', status: source.retrieval_http_status || 0, code: known.code, gap: known.gap, limitations: `Not retried: a known format failure is already stored. ${known.gap}` };
  }
  if (source.verification_status === 'Rejected') {
    return { id: source.id, attempted: false, extraction: 'Failed', sample: '', status: 0, code: 'NOT_ALLOWLISTED', gap: 'Rejected sources are not retrieved.', limitations: 'Rejected sources are not retrieved.' };
  }
  const r = await inspectFetch(source.url, { allowedHosts, deps, config });
  const failureCode = !r.ok && KNOWN_FORMAT_FAILURES.includes(r.code) ? r.code : '';
  const summary = r.ok
    ? `HTTP ${r.status}; ${r.content_type}; ${r.bytes} bytes; SHA-256 ${r.content_hash}; ${r.text_chars} characters of text.`
    : (r.status ? `HTTP ${r.status}; ${r.content_type || 'unknown type'}; ${r.bytes} bytes. ` : 'Not retrieved. ') + r.gap;
  const patch = {
    retrieval_tested_at: r.retrieved_at,
    retrieval_http_status: r.status || 0,
    retrieval_page_title: r.title || '',
    retrieval_result: summary,
    retrieval_content_type: r.content_type,
    retrieval_bytes: r.bytes,
    retrieval_content_hash: r.content_hash,
    retrieval_final_url: r.final_url,
    retrieval_excerpt: r.ok ? r.text.slice(0, EXCERPT_CHARS) : '',
    retrieval_text_chars: r.text_chars,
    retrieval_failure_code: failureCode,
    retrieval_failure_url: failureCode ? source.url : '',
    extraction_status: r.ok ? r.extraction : 'Failed',
    format_gap: r.gap,
    review_attention: r.gap,
  };
  if (r.ok && r.kind === 'pdf') patch.sample_document_url = source.url;
  if (r.ok) patch.publisher_evidence = `${source.publisher_evidence || ''} Retrieved page wording (not proof of provenance): ${r.text.slice(0, 500)}`.slice(-1800);
  await E.Source.update(source.id, patch);
  return { id: source.id, attempted: true, ok: r.ok, extraction: patch.extraction_status, sample: patch.sample_document_url || source.sample_document_url || '', status: r.status, code: r.code, gap: r.gap, content_hash: r.content_hash, limitations: r.ok ? (r.gap || `Retrieved ${r.text_chars} characters of text (${r.kind}).`) : r.gap };
}
