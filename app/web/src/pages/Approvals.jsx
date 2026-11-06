import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { callFunction } from "@/lib/audit";
import useActor from "@/lib/useActor";
import ReviewedSnapshot from '@/components/requirements/ReviewedSnapshot';
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ShieldCheck } from "lucide-react";

const DECISION_TONE = { Pending: "warning", Approved: "success", Rejected: "danger", "Returned for changes": "info" };

export default function Approvals() {
  const actor = useActor();
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("Approved");
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const page = await base44.entities.Approval.list({ sort: "-created_date", limit: 200 });
    setApprovals(page.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(
    () => approvals.filter((a) => (tab === "pending" ? a.decision === "Pending" : a.decision !== "Pending")),
    [approvals, tab]
  );

  const isOwnDraft = selected && actor.email && selected.drafter?.toLowerCase() === actor.email.toLowerCase();
  const canDecide = actor.canApprove && !isOwnDraft;

  const decide = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await callFunction("decideApproval", {
        approval_id: selected.id,
        decision,
        reason,
      });
      if (result?.error) throw new Error(result.error);
      setMessage(result.outcome || "Decision recorded.");
      setSelected(null);
      setReason("");
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Authorised decisions"
        title="Approvals"
        description="Substantive requirement changes and market-permission decisions need a designated reviewer who is not the drafter. Approval authority is enforced server-side and is never implied by administrator access."
      />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 border-b border-border">
          {[{ key: "pending", label: "Pending" }, { key: "decided", label: "Decided" }].map((item) => (
            <button key={item.key} type="button" onClick={() => { setTab(item.key); setSelected(null); }} className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] ${tab === item.key ? "border-green-700 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="text-[11.5px] text-slate-600">
          Your access role: <span className="font-medium text-slate-900">{actor.loading ? "checking…" : actor.role || "not signed in"}</span>
          {!actor.canApprove && !actor.loading && <span className="ml-1 text-amber-700">· no approval authority</span>}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard title={`${rows.length} item${rows.length === 1 ? "" : "s"}`} className="xl:col-span-2">
          <DataTable
            loading={loading}
            rows={rows}
            onRowClick={(row) => { setSelected(row); setMessage(""); setEffectiveDate(row.effective_date || ""); }}
            columns={[
              { key: "approval_ref", header: "Ref", width: "84px", render: (a) => <span className="font-mono text-[11px] text-slate-500">{a.approval_ref}</span> },
              {
                key: "item_title",
                header: "Item",
                render: (a) => (
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{a.item_title}</div>
                    <div className="text-[11px] text-muted-foreground">{a.item_type}</div>
                  </div>
                ),
              },
              { key: "drafter", header: "Drafter", render: (a) => <span className="text-[11.5px]">{a.drafter || "Unknown"}</span> },
              { key: "decision", header: "Decision", render: (a) => <StatusBadge tone={DECISION_TONE[a.decision] || "unknown"}>{a.decision}</StatusBadge> },
              { key: "dates", header: "Requested / decided", render: (a) => <span className="num text-[11px] text-slate-600">{fmtDate(a.created_date)}<br />{a.decided_at ? fmtDateTime(a.decided_at) : "—"}</span> },
            ]}
            empty={<EmptyState icon={ShieldCheck} title={tab === "pending" ? "Nothing awaiting approval" : "No decisions recorded"} description="Approval requests are raised from a requirement with source evidence and an applicability rationale." />}
          />
        </SectionCard>

        <SectionCard title={selected ? `Decide ${selected.approval_ref}` : "Select an item"} description={selected ? selected.item_title : "The decision, its reason and the reviewer are recorded in the audit history."}>
          {!selected ? (
            <EmptyState icon={ShieldCheck} title="Nothing selected" description="Pending approvals appear here with the evidence that was submitted." />
          ) : (
            <div className="space-y-2.5 px-4 py-3 text-[12px]">
              <div className="rounded-sm border border-border bg-slate-50/60 px-2.5 py-2 leading-relaxed text-slate-700">
                <div className="eyebrow mb-1">Submitted summary</div>
                {selected.summary || "No summary supplied."}
              </div>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-muted-foreground">Drafter</span>
                <span className="text-slate-800">{selected.drafter || "Unknown"}</span>
              </div>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-muted-foreground">Evidence checked</span>
                <span className={selected.evidence_checked ? "text-emerald-700" : "text-amber-700"}>{selected.evidence_checked ? "Yes" : "Not confirmed"}</span>
              </div>

              <ReviewedSnapshot value={selected.snapshot_json} />
              {selected.decision === "Pending" ? (
                <>
                  {!actor.canApprove && (
                    <p className="rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-amber-900">
                      Your access role does not carry compliance-approval authority, so this cannot be decided here. An appointed Approver must record the decision.
                    </p>
                  )}
                  {isOwnDraft && (
                    <p className="rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-amber-900">
                      You drafted this item. A different designated reviewer must approve it.
                    </p>
                  )}
                  <label className="block text-[11.5px] text-slate-600">
                    Decision
                    <select value={decision} onChange={(e) => setDecision(e.target.value)} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                      {["Approved", "Rejected", "Returned for changes"].map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                  <label className="block text-[11.5px] text-slate-600">
                    Reviewed effective date (changes require a new submission)
                    <input type="date" value={effectiveDate} readOnly disabled className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
                  </label>
                  <label className="block text-[11.5px] text-slate-600">
                    Reason (required)
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="What you reviewed, and why this decision is correct. Minimum 10 characters." className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]" />
                  </label>
                  <button type="button" onClick={decide} disabled={busy || !canDecide || reason.trim().length < 10} className="rounded-sm bg-green-800 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                    {busy ? "Recording…" : "Record decision"}
                  </button>
                </>
              ) : (
                <div className="space-y-1.5 text-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Decision</span>
                    <StatusBadge tone={DECISION_TONE[selected.decision]}>{selected.decision}</StatusBadge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Decided by</span>
                    <span className="text-slate-800">{selected.decided_by || "—"}</span>
                  </div>
                  <p className="rounded-sm bg-slate-50 px-2.5 py-2 leading-relaxed text-slate-700">{selected.decision_reason || "No reason recorded."}</p>
                </div>
              )}
              {message && <p className="text-[11.5px] text-slate-600">{message}</p>}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}