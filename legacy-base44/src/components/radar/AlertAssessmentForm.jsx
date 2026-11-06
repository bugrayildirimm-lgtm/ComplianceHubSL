import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { logAudit } from "@/lib/audit";
import useActor from "@/lib/useActor";

const OUTCOMES = ["Informational", "Duplicate", "Not applicable", "Requires action"];

export default function AlertAssessmentForm({ alert, onSaved }) {
  const actor = useActor();
  const [outcome, setOutcome] = useState(alert.assessment_outcome === "Not assessed" ? "" : alert.assessment_outcome);
  const [reason, setReason] = useState(alert.assessment_reason || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await base44.entities.RegulatoryAlert.update(alert.id, {
        assessment_outcome: outcome,
        assessment_reason: reason,
        review_status: outcome ? "Assessed" : "Impact assessment in progress",
        assessed_by: actor.email || "",
        assessed_at: new Date().toISOString(),
        priority: alert.priority === "Unclassified" && outcome ? "Medium" : alert.priority,
      });
      await logAudit({
        eventType: "Impact assessment recorded",
        entityType: "RegulatoryAlert",
        entityId: alert.alert_ref,
        entityLabel: alert.title,
        summary: `Impact assessment recorded as "${outcome || "in progress"}" for ${alert.jurisdiction_name}.`,
        detail: reason,
      });
      setMessage("Assessment recorded.");
      onSaved?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="h-8 rounded-sm border border-border bg-white px-2 text-[12.5px]"
          aria-label="Assessment outcome"
        >
          <option value="">Assessment outcome…</option>
          {OUTCOMES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={saving || !actor.canWrite || !outcome || reason.trim().length < 10}
          className="rounded-sm bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Record assessment"}
        </button>
        {!actor.canWrite && <span className="text-[11.5px] text-amber-700">Read-only access — a compliance team member must record this.</span>}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Reasoning: what the publication requires, why it does or does not affect Stakelogic, and what evidence supports that. Minimum 10 characters."
        className="w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px] leading-relaxed"
      />
      {message && <p className="text-[11.5px] text-slate-600">{message}</p>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        AI never records this decision. The assessor is stored with the timestamp; the assessment can be revised but the audit history keeps each change.
      </p>
    </div>
  );
}