// Replacement for Base44's Core integrations. Configure via environment:
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL     InvokeLLM
//   STORAGE_DIR                            private evidence files (default ./data/files)
//   SMTP_URL, MAIL_FROM                    SendEmail (optional; logs when unset)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const storageDir = () => path.resolve(process.env.STORAGE_DIR || path.join(process.env.DATA_DIR || './data', 'files'));

export async function UploadPrivateFile({ file }) {
  const dir = path.join(storageDir(), 'private');
  fs.mkdirSync(dir, { recursive: true });
  const name = String(file.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const key = `${crypto.randomBytes(5).toString('hex')}_${name}`;
  fs.writeFileSync(path.join(dir, key), Buffer.from(await file.arrayBuffer()));
  return { file_uri: `private/${key}` };
}

export function readPrivateFile(uri) {
  const rel = path.normalize(String(uri)).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(storageDir(), rel);
  if (!full.startsWith(storageDir())) throw new Error('Invalid file reference');
  return fs.readFileSync(full);
}

export async function InvokeLLM({ prompt, response_json_schema, add_context_from_internet }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY is not configured; AI analysis is unavailable.'), { status: 503 });
  const body = {
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    max_tokens: 8000,
    messages: [{ role: 'user', content: response_json_schema
      ? `${prompt}\n\nReturn ONLY a JSON value matching this JSON Schema, with no prose:\n${JSON.stringify(response_json_schema)}`
      : prompt }],
  };
  if (add_context_from_internet) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || `LLM request failed (${res.status})`), { status: res.status });
  const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (!response_json_schema) return text;
  const match = text.match(/[\[{][\s\S]*[\]}]/);
  try { return JSON.parse(match ? match[0] : text); }
  catch { throw new Error('The model did not return valid JSON for the requested schema.'); }
}

export async function SendEmail({ to, subject, text, body, from_name }) {
  if (!process.env.SMTP_URL) {
    console.log(`[mail] SMTP_URL not set; not sent. To=${to} Subject=${subject}`);
    return { sent: false, reason: 'SMTP not configured' };
  }
  const { createTransport } = await import('nodemailer');
  const t = createTransport(process.env.SMTP_URL);
  await t.sendMail({ from: `${from_name || 'Compliance Hub'} <${process.env.MAIL_FROM}>`, to, subject, text: text || body });
  return { sent: true };
}

export async function ExtractDataFromUploadedFile() {
  throw Object.assign(new Error('ExtractDataFromUploadedFile is not implemented in the portable server yet.'), { status: 501 });
}

export const Core = { UploadPrivateFile, InvokeLLM, SendEmail, ExtractDataFromUploadedFile };
