// Attaches verbatim evidence to requirements from a spec file.
// Usage (from app/): node --import ./server/register.js scripts/apply-evidence.mjs [spec.json] [--apply]
// Default is a dry run that prints the exact before/after and writes nothing.
// Per requirement it sets ONLY source_excerpt (blocks joined by a "[...]" line) and source_version (capture note
// appended after " | "). No review status, applicability, approval, translation or other field is touched.
// If any check fails for any requirement, nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureTables, entityStore } from '../server/entities.js';
import { getDb } from '../server/db.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const specPath = path.resolve(args.find((a) => !a.startsWith('--')) || '../docs/evidence/dk-evidence-2026-11-07.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(process.env.DATA_DIR || './data', 'files'));
const SEPARATOR = '\n\n[...]\n\n';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

await ensureTables();
const reqStore = entityStore('Requirement');
const docStore = entityStore('DocumentRecord');
const problems = [];
const plans = [];
const fileCache = new Map();

async function retainedFile(sourceId, wantSha) {
  const key = sourceId + '|' + wantSha;
  if (fileCache.has(key)) return fileCache.get(key);
  const docs = await docStore.filter({ source_id: sourceId });
  const found = [];
  for (const d of docs) {
    if (!d.evidence_file_uri) continue;
    const file = path.join(storageDir, d.evidence_file_uri);
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    if (sha256(buf) === wantSha) found.push({ doc: d.id, file, text: buf.toString('utf8') });
  }
  const result = found[0] || null;
  if (found.length > 1) console.log(`note: ${found.length} retained files for ${sourceId} match the SHA-256; using ${result.doc}`);
  fileCache.set(key, result);
  return result;
}

for (const item of spec.requirements) {
  const tag = item.research_key;
  const fail = (m) => problems.push(`${tag}: ${m}`);
  const reqs = await reqStore.filter({ research_key: item.research_key });
  if (reqs.length !== 1) { fail(`expected exactly 1 requirement, found ${reqs.length}`); continue; }
  const req = reqs[0];
  const file = await retainedFile(item.source_id, item.retained_file_sha256);
  if (!file) { fail(`no retained file for ${item.source_id} with SHA-256 ${item.retained_file_sha256}`); continue; }
  let blocksOk = true;
  for (const b of item.blocks) {
    if (!b.text || !file.text.includes(b.text)) { fail(`block "${b.label}" is not an exact substring of the retained file`); blocksOk = false; }
    else if (file.text.slice(b.start, b.end) !== b.text) { fail(`block "${b.label}" does not match the file at offsets ${b.start}-${b.end}`); blocksOk = false; }
  }
  if (!item.capture_note || !item.capture_note.startsWith('Capture note:')) { fail('capture_note missing or not marked "Capture note:"'); blocksOk = false; }
  if (!blocksOk) continue;
  const newExcerpt = item.blocks.map((b) => b.text).join(SEPARATOR);
  if (req.source_excerpt && req.source_excerpt !== newExcerpt) { fail('source_excerpt is already set to different text; refusing to overwrite'); continue; }
  const oldVersion = req.source_version || '';
  if (oldVersion.includes(item.capture_note)) { fail('capture note already present in source_version; already applied?'); continue; }
  const newVersion = oldVersion ? `${oldVersion} | ${item.capture_note}` : item.capture_note;
  plans.push({ req, item, doc: file.doc, newExcerpt, newVersion });
}

if (problems.length) {
  console.error('CHECKS FAILED. Nothing was written.\n- ' + problems.join('\n- '));
  process.exit(1);
}

console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written)'} - spec ${specPath}\nAll checks passed: file SHA-256 matches, every block is an exact substring at its offsets.\n`);
for (const p of plans) {
  console.log('='.repeat(100));
  console.log(`${p.item.research_key}  requirement ${p.req.id}  source ${p.item.source_id}  document record ${p.doc}`);
  console.log('--- source_excerpt BEFORE:\n' + JSON.stringify(p.req.source_excerpt ?? null));
  console.log('--- source_excerpt AFTER (' + p.newExcerpt.length + ' characters):\n' + p.newExcerpt);
  console.log('--- source_version BEFORE:\n' + (p.req.source_version ?? ''));
  console.log('--- source_version AFTER:\n' + p.newVersion);
  console.log('--- all other fields: unchanged\n');
}

if (!apply) { console.log('Dry run only. Re-run with --apply to write.'); (await getDb()).close?.(); process.exit(0); }

for (const p of plans) {
  await reqStore.update(p.req.id, { source_excerpt: p.newExcerpt, source_version: p.newVersion });
  const back = await reqStore.get(p.req.id);
  if (back.source_excerpt !== p.newExcerpt || back.source_version !== p.newVersion) throw new Error(`read-back mismatch for ${p.item.research_key}`);
  console.log(`written: ${p.item.research_key}`);
}
(await getDb()).close?.();
