// Loads a Base44 CSV export (one <Entity>_export.csv per table) into the entity tables,
// converting values using the field types in server/entities/*.jsonc.
// Usage: node --import ./server/register.js scripts/load-csv.js <snapshot-dir> [--replace]
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { ensureTables, loadRegistry, entityStore } from '../server/entities.js';
import { getDb } from '../server/db.js';

const dir = process.argv[2];
const replace = process.argv.includes('--replace');
if (!dir) { console.error('Usage: load-csv.js <snapshot-dir> [--replace]'); process.exit(1); }

function coerce(value, def) {
  const type = def?.type;
  if (type === 'string' || !def) return value;
  if (value === '') return undefined;
  if (type === 'boolean') return value === 'true' || value === 'True' || value === '1';
  if (type === 'number' || type === 'integer') { const n = Number(value); return Number.isNaN(n) ? value : n; }
  if (type === 'array' || type === 'object') { try { return JSON.parse(value); } catch { return value; } }
  return value;
}

await ensureTables();
const registry = loadRegistry();
const db = await getDb();
const report = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('_export.csv')).sort()) {
  const name = file.replace('_export.csv', '');
  if (!registry[name]) { report.push({ name, error: 'no entity definition' }); continue; }
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const records = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
  if (replace) await db.query(`DELETE FROM "e_${name}"`);
  const props = registry[name].properties || {};
  const store = entityStore(name);
  let n = 0;
  for (const rec of records) {
    const doc = {};
    for (const [key, raw] of Object.entries(rec)) {
      if (['id', 'created_date', 'updated_date', 'created_by_id', 'created_by'].includes(key)) { doc[key] = raw || undefined; continue; }
      if (key === 'is_sample') continue;
      const v = coerce(raw, props[key]);
      if (v !== undefined) doc[key] = v;
    }
    await store.create(doc);
    n++;
  }
  report.push({ name, csv_rows: records.length, loaded: n, in_db: await store.count() });
}
console.table(report);
const bad = report.filter((r) => r.error || r.in_db !== r.csv_rows);
if (bad.length) { console.error('MISMATCH', bad); process.exit(2); }
console.log('All tables loaded; row counts match the CSV files.');
await (await getDb()).close();
