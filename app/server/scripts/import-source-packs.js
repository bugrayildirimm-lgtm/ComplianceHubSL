// Imports draft source packs (docs/source-packs/*.json) as new Source records.
// Usage (from app/): node --import ./server/register.js server/scripts/import-source-packs.js [dir] [--dry-run]
//
// - Every new Source is "Awaiting source verification". Nothing is marked verified or collection-authorised.
// - Jurisdictions are matched by jurisdiction_id only. Jurisdiction records are never changed.
// - A URL that already exists as a Source (any status) is skipped; scheme, "www." and a trailing slash are ignored.
//   The same applies to repeats within and across packs, so re-running the import adds nothing.
// - Only Source records are created: no alerts, notifications or collection jobs (rule 4).
// - Rows that fail validation are reported and skipped; the rest are still imported.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTables, entityStore } from '../entities.js';
import { getDb } from '../db.js';

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'source-packs');
const ENUMS = {
  source_type: ['Regulator publication page', 'Technical standards', 'Legislation database', 'Official gazette', 'Parliamentary bill or consultation', 'Court judgment', 'Enforcement publication', 'Other official'],
  collection_method: ['Official feed or API', 'Direct page retrieval', 'Browser rendering', 'Not configured'],
  check_frequency: ['Six-hourly', 'Daily', 'Weekly', 'Manual'],
};
const TRACKING = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];

// URL as stored: http(s) only, no fragment or tracking parameters, no trailing slash (same as sourceReview).
export function cleanUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (!/^https?:$/.test(u.protocol)) return '';
    u.hash = '';
    TRACKING.forEach((k) => u.searchParams.delete(k));
    return u.toString().replace(/\/$/, '');
  } catch { return ''; }
}

// Key for duplicate detection: ignores scheme, "www." and a trailing slash.
export function urlKey(raw) {
  try {
    const u = new URL(String(raw));
    return (u.host.replace(/^www\./i, '') + u.pathname.replace(/\/$/, '') + u.search).toLowerCase();
  } catch { return String(raw || '').trim().toLowerCase(); }
}

export async function importSourcePacks({ dir = DEFAULT_DIR, dryRun = false } = {}) {
  await ensureTables();
  const Source = entityStore('Source');
  const jurisdictions = new Map((await entityStore('Jurisdiction').filter({}, 'jurisdiction_id', 5000)).map((j) => [j.jurisdiction_id, j]));
  const known = new Set((await Source.filter({}, 'created_date', 100000)).map((s) => urlKey(s.url)));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const report = { files: files.length, rows: 0, added: 0, duplicates: [], failed: [], nameDifferences: [] };

  for (const file of files) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const [i, s] of (pack.sources || []).entries()) {
      report.rows++;
      const where = `${file} #${i + 1} ${s.jurisdiction_name || ''} ${s.url || ''}`.trim();
      const errors = [];
      const url = cleanUrl(s.url);
      if (!url) errors.push('url missing or not http(s)');
      if (!String(s.authority || '').trim()) errors.push('authority missing');
      const j = jurisdictions.get(s.jurisdiction_id);
      if (!j) errors.push(`jurisdiction_id not found: ${s.jurisdiction_id}`);
      for (const [key, allowed] of Object.entries(ENUMS)) if (s[key] !== undefined && !allowed.includes(s[key])) errors.push(`${key} invalid: ${s[key]}`);
      if (s.topics !== undefined && !Array.isArray(s.topics)) errors.push('topics is not an array');
      if (errors.length) { report.failed.push({ where, errors }); continue; }

      const key = urlKey(url);
      if (known.has(key)) { report.duplicates.push(where); continue; }
      known.add(key);
      if (j.name !== s.jurisdiction_name) report.nameDifferences.push(`${where}: pack says "${s.jurisdiction_name}", register says "${j.name}" (register name used)`);
      if (!dryRun) {
        await Source.create({
          source_id: `SRC-${crypto.randomUUID()}`,
          jurisdiction_id: j.jurisdiction_id,
          jurisdiction_name: j.name,
          authority: String(s.authority).trim(),
          url,
          source_type: s.source_type || 'Other official',
          language: s.language || 'Unknown',
          topics: s.topics || [],
          territorial_scope: s.territorial_scope || '',
          collection_method: s.collection_method || 'Direct page retrieval',
          check_frequency: s.check_frequency || 'Weekly',
          priority: s.priority === true,
          verification_status: 'Awaiting source verification',
          health_status: 'Awaiting source verification',
          discovered_by: s.discovered_by || '',
          notes: s.notes || '',
        });
      }
      report.added++;
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dir = path.resolve(args.find((a) => !a.startsWith('--')) || DEFAULT_DIR);
  if (!fs.existsSync(dir)) { console.error(`Source pack folder not found: ${dir}`); process.exit(1); }
  const r = await importSourcePacks({ dir, dryRun });
  console.log(`${dryRun ? 'DRY RUN - nothing written. ' : ''}${r.files} pack file(s), ${r.rows} row(s): ${r.added} ${dryRun ? 'would be added' : 'added'}, ${r.duplicates.length} skipped as duplicates, ${r.failed.length} failed validation.`);
  r.duplicates.forEach((d) => console.log('  duplicate:', d));
  r.nameDifferences.forEach((d) => console.log('  name note:', d));
  r.failed.forEach((f) => console.log('  FAILED:', f.where, '-', f.errors.join('; ')));
  await getDb().then((db) => db.close?.());
  process.exit(r.failed.length ? 2 : 0);
}
