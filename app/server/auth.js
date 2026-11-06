// Placeholder authentication: email + password, signed session token (HS256). Single-factor on
// purpose for now; MFA and company SSO are a later phase (see docs/spec.md, "Access").
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { entityStore } from './entities.js';

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[auth] SESSION_SECRET not set; sessions will not survive a restart.');
const TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 12 * 3600);

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyToken(token) {
  const [head, body, sig] = String(token || '').split('.');
  if (!head || !body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  const a = Buffer.from(sig); const e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
}

export async function ensureAuthTables() {
  const db = await getDb();
  await db.query('CREATE TABLE IF NOT EXISTS auth_credentials (email text PRIMARY KEY, salt text NOT NULL, hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
}

const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');

export async function setPassword(email, password) {
  if (String(password).length < 12) throw new Error('Password must be at least 12 characters.');
  const db = await getDb();
  const salt = crypto.randomBytes(16).toString('hex');
  await db.query(
    `INSERT INTO auth_credentials (email, salt, hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash, updated_at = now()`,
    [email.toLowerCase(), salt, hashPassword(password, salt)]);
}

export async function login(email, password) {
  const db = await getDb();
  const rows = await db.query('SELECT salt, hash FROM auth_credentials WHERE email = $1', [String(email).toLowerCase()]);
  // always spend the hash time so unknown emails are not distinguishable by latency
  const salt = rows[0]?.salt || 'x'.repeat(32);
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(rows[0]?.hash || '0'.repeat(128), 'hex');
  if (!rows[0] || !crypto.timingSafeEqual(candidate, stored)) return null;
  const users = await entityStore('User').filter({ email: String(email).toLowerCase() }, null, 1);
  return users[0] ? { token: signToken({ sub: users[0].id, email: users[0].email }), user: users[0] } : null;
}

export function tokenFromRequest(req) {
  const header = req.headers.get ? req.headers.get('authorization') : req.headers.authorization;
  if (header && /^Bearer /i.test(header)) return header.slice(7);
  const cookie = (req.headers.get ? req.headers.get('cookie') : req.headers.cookie) || '';
  const match = cookie.match(/(?:^|;\s*)hub_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function userFromRequest(req) {
  const payload = verifyToken(tokenFromRequest(req));
  if (!payload) return null;
  const users = await entityStore('User').filter({ id: payload.sub }, null, 1);
  return users[0] || null;
}

// Create or update the administrator from the environment (first start / password reset).
export async function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return null;
  const users = entityStore('User');
  const existing = (await users.filter({ email }, null, 1))[0];
  // The bootstrap administrator is admitted directly; everyone else goes through the roster/admitUser flow.
  const fields = { role: 'admin', access_admitted: true };
  if (existing) await users.update(existing.id, fields);
  else {
    // Keep the Base44 identity: the roster and the designated job runner reference its user id.
    const [member] = await entityStore('TeamMember').filter({ user_email: email }, null, 1);
    await users.create({ ...(member?.user_id ? { id: member.user_id } : {}), email, full_name: member?.full_name || process.env.ADMIN_NAME || email, ...fields });
  }
  await setPassword(email, password);
  return email;
}
