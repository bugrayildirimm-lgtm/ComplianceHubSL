import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureTables, entityStore } from '../entities.js';
import { importSourcePacks, urlKey } from '../scripts/import-source-packs.js';

before(async () => { process.env.DATA_DIR = 'memory'; await ensureTables(); });

const row = (over) => ({ jurisdiction_id: 'JUR-T1', jurisdiction_name: 'Testland', authority: 'Test Authority', source_type: 'Legislation database', verification_status: 'Verified', ...over });

test('source-pack import: duplicates skipped, everything awaits verification, no alerts, safe to re-run', async () => {
  await entityStore('Jurisdiction').create({ jurisdiction_id: 'JUR-T1', name: 'Testland', classification: 'Prohibited Territory' });
  await entityStore('Source').create({ source_id: 'SRC-EXISTING', url: 'https://www.example.org/law/', authority: 'Existing', jurisdiction_id: 'JUR-T1', verification_status: 'Verified' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ sources: [
    row({ url: 'http://example.org/law' }), // same as the existing one except scheme, www and slash
    row({ url: 'https://example.org/new-page/' }),
    row({ url: 'https://other.example/x' }),
    row({ url: 'not a url' }), // fails validation
    row({ url: 'https://bad.example/y', jurisdiction_id: 'JUR-NOPE' }), // unknown jurisdiction
  ] }));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ sources: [
    row({ url: 'https://www.example.org/new-page' }), // repeat of a row in another pack
    row({ url: 'https://other.example/x#frag' }),
  ] }));
  const count = async (n) => entityStore(n).count({});
  const jursBefore = await entityStore('Jurisdiction').filter({});
  const before = { alerts: await count('RegulatoryAlert'), notes: await count('Notification'), audit: await count('AuditEvent') };

  const dry = await importSourcePacks({ dir, dryRun: true });
  assert.equal(dry.added, 2);
  assert.equal(await count('Source'), 1, 'dry run writes nothing');

  const first = await importSourcePacks({ dir });
  assert.equal(first.added, 2);
  assert.equal(first.duplicates.length, 3);
  assert.equal(first.failed.length, 2);
  const added = await entityStore('Source').filter({ source_id: { $ne: 'SRC-EXISTING' } });
  assert.equal(added.length, 2);
  for (const s of added) {
    assert.equal(s.verification_status, 'Awaiting source verification', 'a "Verified" value in the pack is ignored');
    assert.ok(!s.verified_by && !s.verified_at && !s.collection_authorised);
  }
  assert.equal(await count('RegulatoryAlert'), before.alerts);
  assert.equal(await count('Notification'), before.notes);
  assert.equal(await count('AuditEvent'), before.audit);
  assert.deepEqual(await entityStore('Jurisdiction').filter({}), jursBefore, 'jurisdictions untouched');

  const again = await importSourcePacks({ dir });
  assert.equal(again.added, 0, 're-run adds nothing');
  assert.equal(await count('Source'), 3);
});

test('urlKey ignores scheme, www and trailing slash only', () => {
  assert.equal(urlKey('http://www.A.org/x/'), urlKey('https://a.org/x'));
  assert.notEqual(urlKey('https://a.org/x'), urlKey('https://a.org/y'));
  assert.notEqual(urlKey('https://a.org/x?p=1'), urlKey('https://a.org/x?p=2'));
});
