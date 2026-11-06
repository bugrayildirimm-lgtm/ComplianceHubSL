import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureTables, entityStore } from '../entities.js';
import { init, createApp } from '../index.js';

let server; let base; let cookie = '';
before(async () => {
  process.env.DATA_DIR = 'memory'; process.env.ADMIN_EMAIL = 'admin@example.test'; process.env.ADMIN_PASSWORD = 'correct horse battery';
  await init();
  await entityStore('TeamMember').create({ email: 'someone@example.test' });
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (path, opts = {}) => fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } });

test('health reports 32 entities and 31 functions', async () => {
  const j = await (await call('/api/health')).json();
  assert.equal(j.entities, 32); assert.equal(j.functions, 31);
});

test('entities require sign-in; wrong password is refused', async () => {
  assert.equal((await call('/api/entities/Source/query', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.test', password: 'nope' }) })).status, 401);
});

test('login, entity CRUD, and entity rules for an unadmitted user', async () => {
  const r = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.test', password: 'correct horse battery' }) });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const created = await (await call('/api/entities/Jurisdiction', { method: 'POST', body: JSON.stringify({ name: 'Testland' }) })).json();
  const got = await (await call(`/api/entities/Jurisdiction/${created.id}`)).json();
  assert.equal(got.name, 'Testland');
  const q = await (await call('/api/entities/Jurisdiction/query', { method: 'POST', body: JSON.stringify({ query: { name: 'Testland' } }) })).json();
  assert.equal(q.length, 1);
  // a non-admin, non-admitted user is denied
  const users = entityStore('User'); const u = await users.create({ email: 'plain@example.test', role: 'user' });
  const { signToken } = await import('../auth.js');
  const t = signToken({ sub: u.id, email: u.email });
  const denied = await fetch(`${base}/api/entities/Jurisdiction/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: '{}' });
  assert.equal(denied.status, 403);
});

test('a ported Base44 function runs end to end and enforces its own authorisation', async () => {
  const unauth = await fetch(`${base}/api/functions/decideApproval`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauth.status, 401);
  const asAdmin = await call('/api/functions/decideApproval', { method: 'POST', body: JSON.stringify({ approval_id: 'missing', decision: 'Approved', reason: 'long enough reason' }) });
  assert.ok([403, 404].includes(asAdmin.status), `expected the function's own gate, got ${asAdmin.status}`);
});
