// Database adapter. DATABASE_URL -> PostgreSQL (production). Otherwise an embedded Postgres
// (PGlite) persisted under DATA_DIR/pgdata, or in memory when DATA_DIR=memory (tests).
import fs from 'node:fs';
import path from 'node:path';

let instance;

export async function getDb() {
  if (instance) return instance;
  if (process.env.DATABASE_URL) {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    instance = {
      kind: 'postgres',
      query: async (text, params = []) => (await pool.query(text, params)).rows,
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.DATA_DIR || './data';
    if (dir !== 'memory') fs.mkdirSync(path.resolve(dir), { recursive: true });
    const db = dir === 'memory' ? new PGlite() : new PGlite(path.resolve(dir, 'pgdata'));
    await db.waitReady;
    instance = {
      kind: 'pglite',
      query: async (text, params = []) => (await db.query(text, params)).rows,
      close: () => db.close(),
    };
  }
  return instance;
}

export async function resetDbForTests() {
  if (instance) await instance.close();
  instance = undefined;
}
