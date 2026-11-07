import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensureTables, entityStore } from '../entities.js';

before(async () => { process.env.DATA_DIR = 'memory'; await ensureTables(); });

test('create/get/update/delete round trip keeps documents intact', async () => {
  const S = entityStore('Source');
  const a = await S.create({ name: 'A', tags: ['x', 'y'], n: 3, nested: { k: 1 } });
  assert.equal((await S.get(a.id)).nested.k, 1);
  const u = await S.update(a.id, { n: 4 });
  assert.equal(u.n, 4); assert.equal(u.name, 'A');
  await S.delete(a.id);
  await assert.rejects(S.get(a.id), /not found/);
});

test('filter operators: eq, array membership, $in, $ne, $nin, $exists, ranges, $regex, $or/$and', async () => {
  const S = entityStore('Jurisdiction');
  await S.bulkCreate([
    { name: 'Denmark', code: 'DK', score: 5, tags: ['eu'], note: 'Spillemyndigheden' },
    { name: 'Sweden', code: 'SE', score: 8, tags: ['eu', 'nordic'] },
    { name: 'Ontario', code: 'ON', score: 2 },
  ]);
  const names = async (q, sort = 'name') => (await S.filter(q, sort)).map((d) => d.name);
  assert.deepEqual(await names({ code: 'DK' }), ['Denmark']);
  assert.deepEqual(await names({ tags: 'nordic' }), ['Sweden']);
  assert.deepEqual(await names({ code: { $in: ['DK', 'ON'] } }), ['Denmark', 'Ontario']);
  assert.deepEqual(await names({ code: { $ne: 'DK' } }), ['Ontario', 'Sweden']);
  assert.deepEqual(await names({ code: { $nin: ['DK', 'SE'] } }), ['Ontario']);
  assert.deepEqual(await names({ tags: { $exists: false } }), ['Ontario']);
  assert.deepEqual(await names({ score: { $gte: 5 } }), ['Denmark', 'Sweden']);
  assert.deepEqual(await names({ score: { $lt: 5 } }), ['Ontario']);
  assert.deepEqual(await names({ name: { $regex: '^den', $options: 'i' } }), ['Denmark']);
  assert.deepEqual(await names({ $or: [{ code: 'SE' }, { score: 2 }] }), ['Ontario', 'Sweden']);
  assert.deepEqual(await names({ $and: [{ tags: 'eu' }, { score: { $gt: 5 } }] }), ['Sweden']);
  assert.deepEqual(await names({ note: null }), ['Ontario', 'Sweden']);
  assert.deepEqual(await names({}, '-score'), ['Sweden', 'Denmark', 'Ontario']);
  assert.equal(await S.count({ tags: 'eu' }), 2);
  assert.equal((await S.filter({}, 'name', 2)).length, 2);
});

test('updateMany is an atomic claim: only one caller wins a conditional update', async () => {
  const A = entityStore('Approval');
  const row = await A.create({ decision: 'Pending', operation_token: 'tok' });
  const claims = await Promise.all([1, 2, 3, 4].map(() => A.updateMany({ id: row.id, decision: 'Pending' }, { $set: { decision: 'Approved' }, $inc: { version: 1 } })));
  assert.equal(claims.reduce((n, c) => n + c.modified_count, 0), 1);
  const after = await A.get(row.id);
  assert.equal(after.decision, 'Approved'); assert.equal(after.version, 1);
});

test('injection attempts in field names are rejected, values are parameterised', async () => {
  const S = entityStore('Notification');
  await assert.rejects(S.filter({ "a'); DROP TABLE x;--": 1 }), /Invalid field path/);
  await S.create({ title: "it's \"quoted\"; DROP TABLE" });
  assert.equal((await S.filter({ title: "it's \"quoted\"; DROP TABLE" })).length, 1);
});

test('list/filter accept positional or options-object arguments and expose page fields', async () => {
  const S = entityStore('Report');
  await S.bulkCreate(Array.from({ length: 7 }, (_, i) => ({ title: `r${i}`, n: i })));
  const a = await S.filter({}, 'n', 3);                    // positional
  const b = await S.filter({}, { sort: 'n', limit: 3 });   // options object
  assert.deepEqual(a.map((d) => d.n), [0, 1, 2]);
  assert.deepEqual(b.map((d) => d.n), [0, 1, 2]);
  assert.equal(b.items[0].n, 0);                           // functions read page.items
  assert.equal(b.has_more, true);
  assert.deepEqual((await S.list({ sort: '-n', limit: 2 })).map((d) => d.n), [6, 5]);
  assert.equal(JSON.stringify(b).startsWith('['), true);   // still serialises as a plain array
  // cursor walk covers every row exactly once, and ends with has_more false
  const seen = []; let cursor; let pages = 0;
  do {
    const page = await S.filter({}, { sort: 'n', limit: 3, ...(cursor ? { cursor } : {}) });
    seen.push(...page.map((d) => d.n)); cursor = page.has_more ? page.next_cursor : undefined; pages++;
  } while (cursor);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6]); assert.equal(pages, 3);
  const last = await S.filter({}, { limit: 100 });
  assert.equal(last.has_more, false); assert.equal(last.next_cursor, '');
});
