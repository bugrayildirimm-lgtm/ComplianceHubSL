import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { logAudit } from "@/lib/audit";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import { fmtDate, fmtDateTime } from "@/lib/format";

const OPTIONS = [
  {
    value: "Newly published development",
    outcome: "Requires action",
    review: "Impact assessment in progress",
    help: "Published recently and genuinely new to the regulator's framework.",
  },
  {
    value: "First discovered by this application",
    outcome: "Informational",
    review: "Assessed",
    help: "A real publication, but older than this application's first check. Nothing changed today.",
  },
  {
    value: "Historical publication (baseline material)",
    outcome: "Informational",
    review: "Assessed",
    help: "Older material useful for the baseline, not a live development.",
  },
  {
    value: "Not a regulatory publication",
    outcome: "Not applicable",
    review: "Closed",
    help: "Navigation, index, archive or otherwise non-substantive page.",
  },
];

function suggestion(alert) {
  if (!alert.source_passages?.length) return OPTIONS[3];
  if (!alert.publication_date) return OPTIONS[1];
  const published = Date.parse(alert.publication_date);
  const detected = Date.parse(alert.detection_date || new Date().toISOString());
  if (Number.isNaN(published)) return OPTIONS[1];
  return detected - published > 90 * 86400000 ? OPTIONS[2] : OPTIONS[0];
}

// Publication provenance: a document first seen is not a regulatory change.
export default function AlertProvenance({ alert, onSaved }) {
  const suggested = suggestion(alert);
  const [choice, setChoice] = useState(alert.assessment_outcome === "Not applicable" ? "Not a regulatory publication" : suggested.value);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selected = OPTIONS.find((option) => option.value === choice) || suggested;

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const previous = { outcome: alert.assessment_outcome, review: alert.review_status, reason: alert.assessment_reason };
      await base44.entities.RegulatoryAlert.update(alert.id, {
        assessment_outcome: selected.outcome,
        review_status: selected.review,
        assessment_reason: `Classification corrected to "${choice}": ${reason || selected.help}`,
        assessed_by: (await base44.auth.me())?.email || "unknown",
        assessed_at: new Date().toISOString(),
      });
      await logAudit({
        eventType: "Alert classification corrected",
        entityType: "RegulatoryAlert",
        entityId: alert.alert_ref,
        entityLabel: alert.title,
        summary: `Classification set to "${choice}" (outcome ${selected.outcome}). Previous outcome ${previous.outcome || "unset"}; previous reason: ${previous.reason || "none"}.`,
      });
      setMessage("Classification recorded with the previous value kept in the audit log.");
      onSaved?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Publication provenance"
      description="A document first discovered by this application is not the same thing as a newly published regulatory development."
    >
      <div className="divide-y divide-border text-[12px]">
        <div className="flex items-start justify-between gap-3 px-4 py-2">
          <span className="shrink-0 text-muted-foreground">Current reading</span>
          <span className="text-right text-slate-800">
            {alert.assessment_outcome === "Not applicable" ? "Not a regulatory publication" : suggested.value}
            <span className="block text-[10.5px] text-muted-foreground">
              {alert.publication_date ? `Published ${fmtDate(alert.publication_date)}` : "No publication date stated in the source"}
              {" · "}retrieved {alert.detection_date ? fmtDate(alert.detection_date) : "unknown"}
            </span>
          </span>
        </div>
        <div className="flex items-start justify-between gap-3 px-4 py-2">
          <span className="shrink-0 text-muted-foreground">Document version</span>
          <span className="text-right text-slate-800">{alert.document_version || "Unknown"}</span>
        </div>
        {alert.previously_untracked && (
          <div className="px-4 py-2">
            <StatusBadge tone="info" dot={false}>Baseline material — found late, not a new change</StatusBadge>
          </div>
        )}
        <div className="space-y-2 px-4 py-3">
          <label className="block text-[11.5px] text-slate-600">
            Classify this publication
            <select value={choice} onChange={(e) => setChoice(e.target.value)} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
              {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}
            </select>
          </label>
          <p className="text-[11px] leading-snug text-muted-foreground">{selected.help}</p>
          <label className="block text-[11.5px] text-slate-600">
            Reason for the classification
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={busy || (alert.assessment_outcome === selected.outcome && !reason)} className="rounded-sm bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
              Record classification
            </button>
            {alert.assessed_at && <span className="text-[10.5px] text-muted-foreground">Last assessed {fmtDateTime(alert.assessed_at)} by {alert.assessed_by || "unknown"}</span>}
          </div>
          {message && <p className="text-[11.5px] text-green-900">{message}</p>}
        </div>
      </div>
    </SectionCard>
  );
}