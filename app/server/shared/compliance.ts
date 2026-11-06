// Shared server-side helpers for the Compliance Hub functions.
// Nothing here is exposed to the browser.

import { evaluateRoster } from './accessPolicy.ts';
import { rosterFor } from './admission.ts';

export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Backend authorisation for operations that call this helper. Native direct
// entity reads use mirrored-field RLS and do not call it. These backend
// admission, write, administration, audit and approval permissions are all
// derived from one active, uniquely matched roster entry bound to this account.
// Platform app-role (including app admin) is reported for information only and
// grants nothing inside the application.
export async function resolveActor(base44) {
  const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
  if (!user) {
    return { user: null, email: null, name: null, role: null, isAppAdmin: false, admitted: false, reason: 'not_signed_in', canWrite: false, canApprove: false, canAdministerRoles: false, canReadAudit: false, member: null };
  }
  let roster = [];
  try {
    roster = await rosterFor(base44, user.email);
  } catch (_e) {
    roster = [];
  }
  const decision = evaluateRoster(roster, user);
  return {
    user,
    member: decision.member,
    admitted: decision.admitted,
    reason: decision.reason,
    email: user.email,
    name: user.full_name || user.email,
    role: decision.role,
    isAppAdmin: user.role === 'admin',
    canWrite: decision.canWrite,
    canApprove: decision.canApprove,
    canAdministerRoles: decision.canAdministerRoles,
    canReadAudit: decision.canReadAudit,
  };
}

export async function logAudit(base44, actor, event) {
  return await base44.asServiceRole.entities.AuditEvent.create({
    event_type: event.event_type, entity_type: event.entity_type || '',
    entity_id: String(event.entity_id || ''), entity_label: event.entity_label || '',
    summary: event.summary, detail: event.detail || '',
    actor_email: actor?.email || 'system', actor_name: actor?.name || 'system',
    actor_role: actor?.role || 'system', actor_user_id: actor?.user?.id || '',
    app_role: actor?.user?.role || '', workspace_role: actor?.user?.collaborator_role || '',
    evidence_class: event.evidence_class || 'Server operation, not proof of a human decision',
    recorded_by: event.recorded_by || 'server function', occurred_at: new Date().toISOString(),
  });
}

export async function nextRef(base44, entityName, field, prefix, pad = 4) {
  const page = await base44.asServiceRole.entities[entityName].filter({}, { sort: "-created_date", limit: 500 });
  const items = page?.items || page || [];
  let max = 0;
  for (const record of items) {
    const value = record?.[field];
    const match = typeof value === "string" ? value.match(/(\d+)\s*$/) : null;
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(pad, "0")}`;
}

export function decodeEntities(input) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ");
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Keep substantive sentences only: menus, cookie banners, navigation and
// boilerplate never count as a regulatory change.
const BOILERPLATE = /(cookie|accept all|privacy policy|sign in|log ?in|subscribe|newsletter|javascript|your browser|enable cookies|follow us|all rights reserved|skip to content)/i;

export function substantiveText(text) {
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && !BOILERPLATE.test(s))
    .join(" ");
}

export async function sha256(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function extractLinks(html, baseUrl, limit = 8) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) !== null && out.length < limit * 3) {
    let href = match[1];
    const label = htmlToText(match[2]).slice(0, 180);
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      href = new URL(href, baseUrl).toString();
    } catch (_e) {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    const interesting = /(publication|publicatie|news|actualit|novita|consulta|consultation|bill|law|legisl|regulat|standard|requirement|decision|sanction|enforcement|gazette|journal|avis|notice|decis|document|\.pdf$)/i.test(href);
    if (!interesting) continue;
    out.push({ url: href, label });
  }
  return out.slice(0, limit);
}

export function nextCheckFrom(frequency, now = new Date()) {
  const next = new Date(now.getTime());
  if (frequency === "Six-hourly") next.setUTCHours(next.getUTCHours() + 6);
  else if (frequency === "Weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "Manual") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCHours(next.getUTCHours() + 24);
  return next.toISOString();
}

export function isDue(iso, now = new Date()) {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}

export function shortText(value, max = 4000) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}