import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureTables, entityStore, loadRegistry } from './entities.js';
import { ensureAuthTables, bootstrapAdmin, login, userFromRequest } from './auth.js';
import { allowed } from './rls.js';
import { callFunction, functionNames } from './functions.js';
import { startScheduler } from './scheduler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  const secureCookie = process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
  const sessionCookie = (token) => `hub_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}${secureCookie ? '; Secure' : ''}`;

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.message });
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, entities: Object.keys(loadRegistry()).length, functions: functionNames().length }));

  // ---- auth
  const attempts = new Map();
  app.post('/api/auth/login', wrap(async (req, res) => {
    const key = `${req.ip}|${String(req.body?.email || '').toLowerCase()}`;
    const rec = attempts.get(key) || { n: 0, until: 0 };
    if (rec.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const result = await login(req.body?.email || '', req.body?.password || '');
    if (!result) {
      rec.n += 1; if (rec.n >= 5) { rec.until = Date.now() + 15 * 60 * 1000; rec.n = 0; }
      attempts.set(key, rec);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    attempts.delete(key);
    res.setHeader('Set-Cookie', sessionCookie(result.token));
    res.json({ token: result.token, user: result.user });
  }));
  app.post('/api/auth/logout', (_req, res) => { res.setHeader('Set-Cookie', 'hub_session=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
  app.get('/api/auth/me', wrap(async (req, res) => {
    const user = await userFromRequest(new Request('http://x/', { headers: { authorization: req.headers.authorization || '', cookie: req.headers.cookie || '' } }));
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    res.json(user);
  }));

  // ---- entities (frontend access, entity-level rules from the schema files)
  const asUser = wrap;
  const guard = (op) => async (req, res, next) => {
    const user = await userFromRequest(new Request('http://x/', { headers: { authorization: req.headers.authorization || '', cookie: req.headers.cookie || '' } }));
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!loadRegistry()[req.params.name]) return res.status(404).json({ error: `Entity ${req.params.name} not found` });
    if (!allowed(req.params.name, op, user)) return res.status(403).json({ error: 'Forbidden' });
    req.user = user; next();
  };
  const store = (req) => entityStore(req.params.name, req.user);
  app.post('/api/entities/:name/query', guard('read'), asUser(async (req, res) => { const { query, sort, limit, skip } = req.body || {}; res.json(await store(req).filter(query || {}, sort, limit, skip)); }));
  app.post('/api/entities/:name/count', guard('read'), asUser(async (req, res) => res.json({ count: await store(req).count(req.body?.query || {}) })));
  app.post('/api/entities/:name/aggregate', guard('read'), asUser(async (req, res) => res.json(await store(req).aggregate(req.body || {}))));
  app.get('/api/entities/:name/:id', guard('read'), asUser(async (req, res) => res.json(await store(req).get(req.params.id))));
  app.post('/api/entities/:name/bulk', guard('create'), asUser(async (req, res) => res.json(await store(req).bulkCreate(req.body || []))));
  app.post('/api/entities/:name', guard('create'), asUser(async (req, res) => res.status(201).json(await store(req).create(req.body || {}))));
  app.put('/api/entities/:name/:id', guard('update'), asUser(async (req, res) => res.json(await store(req).update(req.params.id, req.body || {}))));
  app.delete('/api/entities/:name/:id', guard('delete'), asUser(async (req, res) => res.json(await store(req).delete(req.params.id))));

  // ---- backend functions (same contract as Base44: Request in, Response out)
  app.post('/api/functions/:name', wrap(async (req, res) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !['host', 'content-length'].includes(k)) headers.set(k, String(v));
    headers.set('content-type', 'application/json');
    const response = await callFunction(req.params.name, new Request(`http://localhost${req.originalUrl}`, { method: 'POST', headers, body: JSON.stringify(req.body ?? {}) }));
    res.status(response.status);
    const type = response.headers.get('content-type'); if (type) res.type(type);
    res.send(Buffer.from(await response.arrayBuffer()));
  }));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}

export async function init() {
  await ensureTables();
  await ensureAuthTables();
  const admin = await bootstrapAdmin();
  if (admin) console.log(`[auth] administrator ready: ${admin}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await init();
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`Compliance Hub listening on :${port}`));
  if (process.env.SCHEDULER_ENABLED === 'true') startScheduler();
  else console.log('[scheduler] disabled (set SCHEDULER_ENABLED=true to run the workflow schedules)');
}
