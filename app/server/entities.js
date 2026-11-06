// Entity store: one Postgres table per entity, documents kept as JSONB. Entity names and
// field definitions come from server/entities/*.jsonc (copied verbatim from the Base44 export).
// Implements the Base44 entity surface the app uses: list/filter/get/create/bulkCreate/update/
// updateMany/bulkUpdate/delete/count/aggregate with Mongo-style filters.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';
import { getDb } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const COLUMNS = new Set(['id', 'created_date', 'updated_date', 'created_by', 'created_by_id', 'is_sample']);

let registry;
export function loadRegistry() {
  if (registry) return registry;
  registry = {};
  const dir = path.join(here, 'entities');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonc'))) {
    const def = parseJsonc(fs.readFileSync(path.join(dir, file), 'utf8'));
    registry[def.name] = def;
  }
  return registry;
}

const table = (name) => {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`Invalid entity name: ${name}`);
  return `"e_${name}"`;
};

export async function ensureTables() {
  const db = await getDb();
  for (const name of Object.keys(loadRegistry())) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table(name)} (
      id text PRIMARY KEY,
      created_date timestamptz NOT NULL DEFAULT now(),
      updated_date timestamptz NOT NULL DEFAULT now(),
      created_by text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
  }
}

// ---- query translation -------------------------------------------------------------------

class Builder {
  constructor() { this.params = []; }
  add(value) { this.params.push(value); return `$${this.params.length}`; }
  json(value) { return `${this.add(JSON.stringify(value === undefined ? null : value))}::jsonb`; }
}

function fieldExpr(field) {
  if (field === 'created_by_id') field = 'created_by';
  if (COLUMNS.has(field)) {
    // timestamps compare as ISO strings to match how documents store dates
    if (field === 'created_date' || field === 'updated_date') return { json: `to_jsonb(to_char(${field} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`, text: `to_char(${field} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` };
    return { json: `to_jsonb(${field})`, text: field };
  }
  const parts = field.split('.');
  if (!parts.every((p) => /^[A-Za-z0-9_$-]+$/.test(p))) throw new Error(`Invalid field path: ${field}`);
  const pg = `'{${parts.join(',')}}'`;
  return { json: `(data #> ${pg})`, text: `(data #>> ${pg})` };
}

function eqClause(b, f, value) {
  if (value === null || value === undefined) return `(${f.json} IS NULL OR ${f.json} = 'null'::jsonb)`;
  const lit = b.json(value);
  // Mongo semantics: equality against an array field matches any element
  return `(${f.json} = ${lit} OR (jsonb_typeof(${f.json}) = 'array' AND ${f.json} @> jsonb_build_array(${lit})))`;
}

function opClause(b, f, op, arg, options) {
  switch (op) {
    case '$eq': return eqClause(b, f, arg);
    case '$ne': return `NOT ${eqClause(b, f, arg)}`;
    case '$in': return arg.length ? `(${arg.map((v) => eqClause(b, f, v)).join(' OR ')})` : 'FALSE';
    case '$nin': return arg.length ? `NOT (${arg.map((v) => eqClause(b, f, v)).join(' OR ')})` : 'TRUE';
    case '$gt': return `(${f.json} > ${b.json(arg)})`;
    case '$gte': return `(${f.json} >= ${b.json(arg)})`;
    case '$lt': return `(${f.json} < ${b.json(arg)})`;
    case '$lte': return `(${f.json} <= ${b.json(arg)})`;
    case '$exists': return arg ? `(${f.json} IS NOT NULL AND ${f.json} <> 'null'::jsonb)` : `(${f.json} IS NULL OR ${f.json} = 'null'::jsonb)`;
    case '$regex': {
      const flags = String(options || '');
      const re = arg instanceof RegExp ? arg.source : String(arg);
      return `(${f.text} ${flags.includes('i') ? '~*' : '~'} ${b.add(re)})`;
    }
    case '$options': return null;
    default: throw new Error(`Unsupported filter operator: ${op}`);
  }
}

export function buildWhere(b, query) {
  if (!query || typeof query !== 'object') return 'TRUE';
  const clauses = [];
  for (const [key, value] of Object.entries(query)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      const subs = value.map((q) => buildWhere(b, q));
      if (!subs.length) { clauses.push(key === '$or' ? 'FALSE' : 'TRUE'); continue; }
      if (key === '$and') clauses.push(`(${subs.join(' AND ')})`);
      else if (key === '$or') clauses.push(`(${subs.join(' OR ')})`);
      else clauses.push(`NOT (${subs.join(' OR ')})`);
      continue;
    }
    const f = fieldExpr(key);
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp)
        && Object.keys(value).some((k) => k.startsWith('$'))) {
      for (const [op, arg] of Object.entries(value)) {
        const c = opClause(b, f, op, arg, value.$options);
        if (c) clauses.push(c);
      }
    } else if (value instanceof RegExp) {
      clauses.push(opClause(b, f, '$regex', value, value.flags));
    } else {
      clauses.push(eqClause(b, f, value));
    }
  }
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

function orderBy(sort) {
  if (!sort) return 'created_date DESC, id';
  const keys = Array.isArray(sort) ? sort : String(sort).split(',').map((s) => s.trim()).filter(Boolean);
  if (!keys.length) return 'created_date DESC, id';
  return keys.map((k) => {
    const desc = k.startsWith('-');
    const f = fieldExpr(desc ? k.slice(1) : k);
    return `${f.json} ${desc ? 'DESC' : 'ASC'} NULLS LAST`;
  }).join(', ') + ', id';
}

const toDoc = (row) => ({
  ...row.data,
  id: row.id,
  created_date: new Date(row.created_date).toISOString(),
  updated_date: new Date(row.updated_date).toISOString(),
  created_by: row.created_by ?? undefined,
});

function splitInput(input) {
  const { id, created_date, updated_date, created_by, created_by_id, ...data } = input || {};
  return { id, created_date, updated_date, created_by: created_by || created_by_id, data };
}

export function entityStore(name, actor = null) {
  if (!loadRegistry()[name]) throw Object.assign(new Error(`Entity ${name} not found`), { status: 404 });
  const T = table(name);

  const select = async (query, sort, limit, skip) => {
    const db = await getDb();
    const b = new Builder();
    const where = buildWhere(b, query);
    let sql = `SELECT * FROM ${T} WHERE ${where} ORDER BY ${orderBy(sort)}`;
    if (limit) sql += ` LIMIT ${Math.max(0, Number(limit) | 0)}`;
    if (skip) sql += ` OFFSET ${Math.max(0, Number(skip) | 0)}`;
    return (await db.query(sql, b.params)).map(toDoc);
  };


  // data expression for a Mongo-style update; supports plain merge, $set, $unset, $inc.
  const atomicUpdate = async (query, update) => {
    const db = await getDb();
    const b = new Builder();
    const ops = Object.keys(update || {}).some((k) => k.startsWith('$')) ? update : { $set: update || {} };
    for (const k of Object.keys(ops)) {
      if (!['$set', '$unset', '$inc'].includes(k)) throw new Error(`Unsupported update operator: ${k}`);
    }
    let expr = 'data';
    if (ops.$set && Object.keys(ops.$set).length) {
      const { id, created_date, updated_date, created_by, created_by_id, ...rest } = ops.$set;
      expr = `(${expr} || ${b.json(rest)})`;
    }
    for (const key of Object.keys(ops.$unset || {})) expr = `(${expr} - ${b.add(key)}::text)`;
    for (const [key, amount] of Object.entries(ops.$inc || {})) {
      expr = `jsonb_set(${expr}, ARRAY[${b.add(key)}::text], to_jsonb(COALESCE((${expr} ->> ${b.add(key)}::text)::numeric, 0) + ${b.add(Number(amount))}::numeric))`;
    }
    const where = buildWhere(b, query);
    const rows = await db.query(`UPDATE ${T} SET data = ${expr}, updated_date = now() WHERE ${where} RETURNING *`, b.params);
    return rows.map(toDoc);
  };

  const insert = async (input) => {
    const db = await getDb();
    const { id, created_date, updated_date, created_by, data } = splitInput(input);
    const rows = await db.query(
      `INSERT INTO ${T} (id, created_date, updated_date, created_by, data)
       VALUES ($1, COALESCE($2::timestamptz, now()), COALESCE($3::timestamptz, now()), $4, $5::jsonb) RETURNING *`,
      [id || crypto.randomUUID().replace(/-/g, '').slice(0, 24), created_date || null, updated_date || null,
        created_by || actor?.email || null, JSON.stringify(data)]
    );
    return toDoc(rows[0]);
  };

  return {
    list: (sort, limit, skip) => select({}, sort, limit, skip),
    filter: (query, sort, limit, skip) => select(query, sort, limit, skip),
    async get(id) {
      const rows = await select({ id }, null, 1);
      if (!rows[0]) throw Object.assign(new Error(`${name} ${id} not found`), { status: 404 });
      return rows[0];
    },
    create: insert,
    async bulkCreate(items) { const out = []; for (const item of items) out.push(await insert(item)); return out; },
    async update(id, update) {
      const rows = await atomicUpdate({ id }, update);
      if (!rows.length) throw Object.assign(new Error(`${name} ${id} not found`), { status: 404 });
      return rows[0];
    },
    // Single conditional UPDATE statement, so a claim like { id, operation_token } is atomic
    // (approvals rely on this for replay protection). Returns { modified_count }.
    async updateMany(query, update) {
      const rows = await atomicUpdate(query, update);
      return { modified_count: rows.length };
    },
    async bulkUpdate(items) { const out = []; for (const { id, data, ...rest } of items) out.push(await this.update(id, data || rest)); return out; },
    async delete(id) { const db = await getDb(); await db.query(`DELETE FROM ${T} WHERE id = $1`, [id]); return { success: true }; },
    async deleteMany(query) { const docs = await select(query); for (const d of docs) await this.delete(d.id); return { deleted_count: docs.length }; },
    async count(query = {}) {
      const db = await getDb();
      const b = new Builder();
      const rows = await db.query(`SELECT count(*)::int AS n FROM ${T} WHERE ${buildWhere(b, query)}`, b.params);
      return rows[0].n;
    },
    // { groupBy: 'field', query?: {...} } -> [{ _id: value, count }]
    async aggregate({ groupBy, query = {} } = {}) {
      const db = await getDb();
      const b = new Builder();
      const f = fieldExpr(groupBy);
      const rows = await db.query(
        `SELECT ${f.text} AS key, count(*)::int AS count FROM ${T} WHERE ${buildWhere(b, query)} GROUP BY 1 ORDER BY 2 DESC`, b.params);
      return rows.map((r) => ({ _id: r.key, [groupBy]: r.key, count: r.count }));
    },
  };
}
