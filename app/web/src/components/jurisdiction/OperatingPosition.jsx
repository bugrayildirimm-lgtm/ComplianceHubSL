import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import { fmtDateTime } from "@/lib/format";
import { Activity, AlertTriangle, Paperclip, ShieldAlert } from "lucide-react";

function Tile({ label, value, hint, tone }) {
  return (
    <div className="bg-white px-3.5 py-2.5">
      <div className="num text-[18px] font-semibold leading-tight text-slate-900">{value}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{label}</div>
      {hint && <div className={`mt-1 text-[10.5px] ${tone || "text-slate-500"}`}>{hint}</div>}
    </div>
  );
}

export default function OperatingPosition({ jurisdiction, sources = [], alerts = [], requirements = [], documents = [], config, coveredTopics = 0, totalTopics = 0 }) {
  const enabled = sources.filter((s) => s.verification_status === "Verified" || s.collection_authorised === true);
  const checked = enabled.filter((s) => s.last_success_at);
  const pending = sources.filter((s) => !enabled.includes(s));
  const failed = sources.filter((s) => s.health_status === "Failed or blocked");
  const lastCheck = checked.map((s) => s.last_success_at).sort().pop() || null;
  const nextCheck = enabled.map((s) => s.next_check_at).filter(Boolean).sort()[0] || null;
  const changed = documents.filter((d) => ["New", "Amended", "Replaced at same URL"].includes(d.change_type));
  const unreviewed = alerts.filter((a) => !a.withdrawn && a.review_status === "Draft — unreviewed");
  const withEvidence = requirements.filter((r) => r.evidence_document_id);
  const attachmentGaps = documents.filter((d) => String(d.attachment_gaps || "").trim());
  const scheduleRunning = Boolean(config && config.monitoring_enabled !== false && config.budget_paused !== true);
  const active = checked.length > 0 && scheduleRunning;

  return (
    <SectionCard
      title="Operating position"
      description="What this jurisdiction's monitoring actually does — collected evidence only. Not a statement of legal coverage."
      actions={
        <StatusBadge tone={active ? "info" : "warning"}>
          {active ? "Monitoring active — partial coverage" : "Not monitoring yet"}
        </StatusBadge>
      }
    >
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <Tile label="Accountable department" value={jurisdiction.primary_owner_team || "Unassigned"} hint={jurisdiction.ownership_status} />
        <Tile label="Sources enabled" value={enabled.length} hint={`${checked.length} successfully checked`} tone={checked.length ? "text-emerald-700" : "text-amber-700"} />
        <Tile label="Last successful check" value={lastCheck ? fmtDateTime(lastCheck) : "Never"} />
        <Tile label="Next scheduled check" value={nextCheck ? fmtDateTime(nextCheck) : scheduleRunning ? "Not scheduled" : "Schedule paused"} />
        <Tile label="New or changed captures" value={changed.length} hint={`${documents.length} document capture(s)`} />
        <Tile label="Unreviewed alerts" value={unreviewed.length} tone={unreviewed.length ? "text-amber-700" : "text-slate-500"} />
        <Tile label="Requirements with evidence" value={`${withEvidence.length}/${requirements.length}`} hint="Captured source text attached" />
        <Tile label="Topic coverage" value={`${coveredTopics}/${totalTopics}`} hint="Areas with an enabled source" />
      </div>

      <div className="space-y-2 px-4 py-3 text-[12px]">
        {failed.length > 0 && (
          <div className="flex items-start gap-1.5 text-red-800">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{failed.length} source(s) failed or blocked: {failed.slice(0, 3).map((s) => s.authority).join(", ")}.</span>
          </div>
        )}
        {attachmentGaps.length > 0 && (
          <div className="flex items-start gap-1.5 text-amber-800">
            <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{attachmentGaps.length} capture(s) carry unread or unextractable attachments — recorded as gaps, never as reviewed.</span>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex items-start gap-1.5 text-slate-600">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Pending candidates (shown separately, not counted as coverage): {pending.length} source(s) awaiting verification or authorisation.</span>
          </div>
        )}
        {active && (
          <div className="flex items-start gap-1.5 text-slate-500">
            <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Scope of the claim: these {checked.length} source(s) were retrieved by the managed browser. No legal applicability, market permission or
              complete-register coverage is asserted, and internal classification stays separate from legal verification.
            </span>
          </div>
        )}
      </div>
    </SectionCard>
  );
}