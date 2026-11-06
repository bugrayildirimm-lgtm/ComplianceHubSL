import moment from "moment";

const TZ = "Europe/Malta";

function formatValue(value, options) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...options }).format(date);
}

export function fmtDate(value) {
  if (!value) return "—";
  return formatValue(value, { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(value) {
  if (!value) return "—";
  return formatValue(value, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtTime(value) {
  if (!value) return "—";
  return formatValue(value, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fromNow(value) {
  if (!value) return "never";
  const m = moment(value);
  return m.isValid() ? m.fromNow() : "unknown";
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  return dateStr < todayISO();
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((Date.parse(dateStr) - Date.parse(todayISO())) / 86400000);
}

export const CLASSIFICATION_TONE = {
  "Licensed Jurisdiction": "success",
  "Conditionally Permitted": "info",
  "Prohibited Territory": "danger",
  "Not on RTL / Under Consideration": "warning",
  Unknown: "unknown",
};

export const STAGE_TONE = {
  "Official announcement or discussion": "neutral",
  "Proposal or draft legislation": "info",
  Consultation: "warning",
  "Adopted not yet effective": "warning",
  "In force": "danger",
  "Official guidance": "accent",
  "Enforcement action": "danger",
  "Court judgment": "accent",
  Unknown: "unknown",
};

export const PRIORITY_TONE = {
  Critical: "danger",
  High: "danger",
  Medium: "warning",
  Low: "neutral",
  Unclassified: "unknown",
};

export const APPROVAL_TONE = {
  "Candidate — unreviewed": "warning",
  "In review": "info",
  Approved: "success",
  Rejected: "danger",
  Superseded: "neutral",
};

export const APPLICABILITY_TONE = {
  Unknown: "unknown",
  Applicable: "success",
  "Not applicable": "neutral",
  "Under review": "warning",
};

export const IMPLEMENTATION_TONE = {
  Unknown: "unknown",
  "Gap identified": "danger",
  "Action assigned": "warning",
  "Evidence submitted": "info",
  Implemented: "success",
  "Not applicable": "neutral",
};

export const OWNERSHIP_TONE = {
  Assigned: "success",
  "Ownership review": "danger",
  "Pending confirmation": "warning",
};

export const VERIFICATION_TONE = {
  "Awaiting source verification": "warning",
  Verified: "success",
  Rejected: "danger",
  Superseded: "neutral",
};

export const HEALTH_TONES = {
  "Not configured": "unknown",
  "Awaiting source verification": "warning",
  Queued: "info",
  Running: "info",
  "Checked — new or changed": "success",
  "Checked — no change": "success",
  "Failed or blocked": "danger",
  "Partially processed": "warning",
  "Stale or overdue": "danger",
};

export const JOBS_TONE = {
  Queued: "info",
  Running: "info",
  Succeeded: "success",
  "Failed or blocked": "danger",
  "Partially processed": "warning",
  Skipped: "neutral",
};

export const REVIEW_TONE = {
  "Draft — unreviewed": "warning",
  "Impact assessment in progress": "info",
  Assessed: "success",
  Closed: "neutral",
};

export const LEGAL_STAGES = Object.keys(STAGE_TONE);
export const CLASSIFICATIONS = Object.keys(CLASSIFICATION_TONE).filter((k) => k !== "Unknown");
export const CATEGORIES = [
  "A. Market Entry & Legal",
  "B. Slots Technical",
  "C. Live Casino Game Technical",
  "D. Live Studio & Operational",
];
export const COVERAGE_TOPICS = [
  "Market entry and licensing",
  "Slots technical standards",
  "Live casino technical standards",
  "Live studio operational",
  "Legislation and gazettes",
  "Consultations and bills",
  "Enforcement and judgments",
];