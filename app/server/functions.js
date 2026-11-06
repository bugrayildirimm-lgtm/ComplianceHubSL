// Loads the ported backend functions (server/functions/<name>/entry.ts) and exposes them as
// handlers taking a Web Request and returning a Web Response, exactly as on Base44.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'functions');
const cache = new Map();

export const functionNames = () => fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'entry.ts')));

export async function loadFunction(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !functionNames().includes(name)) return null;
  if (!cache.has(name)) cache.set(name, (await import(pathToFileURL(path.join(dir, name, 'entry.ts')).href)).default);
  return cache.get(name);
}

export async function callFunction(name, req) {
  const handler = await loadFunction(name);
  if (!handler) return new Response(JSON.stringify({ error: `Function ${name} not found` }), { status: 404, headers: { 'content-type': 'application/json' } });
  return handler(req);
}
