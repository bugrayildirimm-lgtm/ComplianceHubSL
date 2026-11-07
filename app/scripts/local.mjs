// One-command local run: node scripts/local.mjs   (or: npm run local)
// First run installs dependencies, builds the frontend, creates .env, loads the data snapshot
// into the embedded database, then starts the server. Later runs just start it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(appDir);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) { console.error(`\nFailed: ${cmd} ${args.join(' ')}`); process.exit(r.status || 1); }
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`Node ${process.versions.node} is too old. Install Node 22.18 or newer from https://nodejs.org and run again.`);
  process.exit(1);
}

if (!fs.existsSync('node_modules')) { console.log('Installing server dependencies...'); run(npm, ['install']); }
if (!fs.existsSync('web/node_modules')) { console.log('Installing frontend dependencies (first run takes a few minutes)...'); run(npm, ['install'], { cwd: 'web' }); }
if (!fs.existsSync('web/dist')) { console.log('Building the frontend...'); run(npm, ['exec', '--', 'vite', 'build'], { cwd: 'web' }); }

if (!fs.existsSync('.env')) {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => { process.stdout.write(q); const { value, done } = await lines.next(); if (done) { console.error('\nInput ended before setup finished.'); process.exit(1); } return value; };
  console.log('\nFirst-time setup. This creates a local-only .env file (it is git-ignored).');
  const email = ((await ask('Administrator email [amtbgryldrm@gmail.com]: ')).trim() || 'amtbgryldrm@gmail.com');
  let password = '';
  while (password.length < 12) password = (await ask('Choose a password (12+ characters; typed text is visible): ')).trim();
  const key = (await ask('Anthropic API key for AI analysis (optional, press Enter to skip): ')).trim();
  rl.close();
  fs.writeFileSync('.env', [
    `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    `ADMIN_EMAIL=${email}`,
    `ADMIN_PASSWORD=${password}`,
    `ANTHROPIC_API_KEY=${key}`,
    'DATA_DIR=./data',
    'PORT=3000',
    'SCHEDULER_ENABLED=false',
    '',
  ].join('\n'), { mode: 0o600 });
}

const env = { ...process.env };
delete env.DATABASE_URL; // local runs use the embedded database; ignore any DATABASE_URL left in the shell (.env can still set it)
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2] !== '') env[m[1]] = m[2];
}
env.SCHEDULER_ENABLED = 'false'; // local runs never collect; see docs/cutover.md

if (!fs.existsSync(path.join(env.DATA_DIR || './data', 'pgdata'))) {
  const snapshot = path.resolve(appDir, '..', 'data', 'snapshot-2026-11-06');
  if (!fs.existsSync(snapshot)) { console.error(`Data snapshot not found at ${snapshot}`); process.exit(1); }
  console.log('Loading the data snapshot (one time)...');
  run(process.execPath, ['--import', './server/register.js', 'scripts/load-csv.js', snapshot], { env, shell: false });
}

const port = env.PORT || '3000';
console.log(`\nStarting. Open http://localhost:${port} and sign in as ${env.ADMIN_EMAIL}. Press Ctrl+C to stop.\n`);
const child = spawn(process.execPath, ['--import', './server/register.js', 'server/index.js'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
