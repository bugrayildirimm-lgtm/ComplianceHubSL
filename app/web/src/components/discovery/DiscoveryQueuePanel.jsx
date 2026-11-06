import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { callFunction } from "@/lib/audit";
import { logAudit } from "@/lib/audit";
import DataTable from "@/components/DataTable";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { HEALTH_TONES, fmtDateTime } from "@/lib/format";
import { ListChecks, PlayCircle, RefreshCw, ShieldQuestion } from "lucide-react";

const QUEUE_TONE = {
  "Not started": "unknown",
  "Queued": "info",
  "Researching": "info",
  "Candidates proposed": "warning",
  "Coverage partial": "warning",
  "Verified sources available": "success",
  "Blocked — ambiguous register record": "danger",
  "Blocked — retrieval failed": "danger",
  "Blocked — budget or usage limit": "danger",
};

const RUN_TONE = { Completed: "success", "Partially completed": "warning", Running: "info", "Blocked — budget or usage limit": "danger", Failed: "danger" };

export default function DiscoveryQueuePanel() {
  const [queue, setQueue] = useState([]);
  const [runs, setRuns] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [limit, setLimit] = useState(4);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    const [qPage, rPage, cPage] = await Promise.all([
      base44.entities.DiscoveryQueue.list({ limit: 500 }),
      base44.entities.DiscoveryRun.list({ sort: "-created_date", limit: 40 }),
      base44.entities.MonitoringConfig.list({ limit: 5 }),
    ]);
    setQueue((qPage.items || []).sort((a, b) => (a.priority_rank || 9) - (b.priority_rank || 9) || String(a.jurisdiction_name).localeCompare(String(b.jurisdiction_name))));
    setRuns(rPage.items || []);
    setConfig((cPage.items || [])[0] || null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setBusy(true); setMessage("Rebuilding the queue from the master register…");
    try {
      const result = await callFunction("discoveryQueue", {});
      if (result?.error) throw new Error(result.error);
      setMessage(`Queue covers ${result.queue_total} jurisdiction(s); ${result.queue_ready} ready for research. Baseline matrix: ${result.baseline_total} cells.`);
      await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const runBatch = async () => {
    setBusy(true); setMessage("Researching the next batch… publisher pages are being retrieved and tested.");
    try {
      const result = await callFunction("runDiscoveryBatch", { limit, trigger_type: "Manual" });
      if (result?.error) throw new Error(result.error);
      if (result?.blocked) setMessage(`Batch did not run: ${result.reason}`);
      else setMessage(`${result.run_ref}: researched ${result.processed} jurisdiction(s) — ${result.candidates_created} candidate source(s) retrieved and tested, ${result.failures?.length || 0} failure(s). All candidates await verification. ${result.remaining} item(s) still queued.`);
      await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const verifyBatch = async () => {
    setBusy(true); setMessage("");
    try {
      const statement = window.prompt("Batch verification statement: name the publisher evidence you checked and the topics covered (required). A successful HTTP response alone is not verification.");
      if (!statement) { setBusy(false); return; }
      const pending = await base44.entities.Source.filter({ verification_status: "Awaiting source verification" });
      const ids = pending.filter((s) => !s.is_fixture).map((s) => s.id);
      if (!ids.length) throw new Error("No candidate is awaiting verification.");
      const result = await callFunction("sourceReview", { op: "verify", source_ids: ids, evidence: statement });
      if (result?.error) throw new Error(result.error);
      setMessage(`${result.decided.length} source(s) verified by your decision; ${result.refused.length} refused because retrieval, publisher evidence or topic coverage was missing.`);
      await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const byStatus = useMemo(() => queue.reduce((acc, q) => { acc[q.status] = (acc[q.status] || 0) + 1; return acc; }, {}), [queue]);
  const filtered = useMemo(() => queue.filter((q) => !statusFilter || q.status === statusFilter), [queue, statusFilter]);
  const pendingCandidates = runs.filter((r) => r.run_kind === "Source discovery").reduce((acc, r) => acc + (r.candidates_created || 0), 0);
  const blocked = queue.filter((q) => /Blocked/.test(q.status));

  return (
    <div className="space-y-5">
      <SectionCard
        title="Resumable discovery queue — every jurisdiction in the register"
        description="Licensed and conditionally permitted markets are researched first, then prospective and prohibited territories. A batch claims a few jurisdictions at a time; queued work survives a pause."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-8 rounded-sm border border-border bg-white px-2 text-[12px]">
              {[2, 4, 6].map((n) => <option key={n} value={n}>{n} per batch</option>)}
            </select>
            <button type="button" onClick={seed} disabled={busy} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700 disabled:opacity-40">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh queue
            </button>
            <button type="button" onClick={runBatch} disabled={busy} className="inline-flex items-center gap-1.5 rounded-sm bg-slate-900 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
              <PlayCircle className="h-3.5 w-3.5" /> Run next batch
            </button>
            <button type="button" onClick={verifyBatch} disabled={busy} className="rounded-sm bg-green-800 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
              Verify retrieved candidates
            </button>
          </div>
        }
      >
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["In queue", queue.length, "master jurisdictions"],
            ["Ready", byStatus.Queued || 0, "no research run yet"],
            ["Candidates proposed", (byStatus["Candidates proposed"] || 0) + (byStatus["Coverage partial"] || 0), "awaiting verification"],
            ["Verified sources", byStatus["Verified sources available"] || 0, "topic coverage partial unless 7/7"],
            ["Blocked", blocked.length, "needs a person"],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-white px-4 py-3">
              <div className={`num text-[19px] font-semibold ${label === "Blocked" && value ? "text-red-700" : "text-slate-900"}`}>{value}</div>
              <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
              <div className="text-[11px] text-muted-foreground">{note}</div>
            </div>
          ))}
        </div>

        {message && <div className="border-b border-border bg-green-50/60 px-4 py-2 text-[12px] text-green-900">{message}</div>}

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-[11.5px] text-slate-600">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-sm border border-border bg-white px-2 text-[12px]">
            <option value="">All</option>
            {Object.keys(QUEUE_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {pendingCandidates} candidate source(s) proposed so far · last discovery {config?.last_discovery_run_at ? fmtDateTime(config.last_discovery_run_at) : "never"}
          </span>
        </div>

        <DataTable
          loading={loading}
          rows={filtered}
          columns={[
            { key: "jurisdiction_name", header: "Jurisdiction", render: (q) => (
              <div>
                <div className="font-medium text-slate-900">{q.jurisdiction_name}</div>
                <div className="text-[10.5px] text-muted-foreground">rank {q.priority_rank} · {q.internal_classification}</div>
              </div>
            ) },
            { key: "status", header: "Status", render: (q) => <StatusBadge tone={QUEUE_TONE[q.status] || "unknown"}>{q.status}</StatusBadge> },
            { key: "attempts", header: "Tries", render: (q) => <span className="num text-[11.5px]">{q.attempts || 0}</span> },
            { key: "candidates", header: "Candidates", render: (q) => <span className="num text-[11.5px]">{q.candidates_found || 0} found · {q.candidates_tested_ok || 0} tested OK · {q.verified_sources || 0} verified</span> },
            { key: "topics", header: "Topic coverage", render: (q) => <span className="num text-[11.5px]">{(q.topics_covered || []).length} / {(q.topics_targeted || []).length || 7}</span> },
            { key: "gaps", header: "Gaps / reason", render: (q) => <span className="max-w-[380px] text-[11px] leading-snug text-slate-600">{q.coverage_gaps || q.block_reason || "—"}</span> },
            { key: "last", header: "Last run", render: (q) => <span className="num text-[10.5px] text-slate-500">{q.last_run_at ? fmtDateTime(q.last_run_at) : "never"}</span> },
          ]}
          empty={<EmptyState icon={ListChecks} title="Queue not built" description="Refresh the queue to create one row per master jurisdiction and a requirements baseline cell per category." />}
        />
      </SectionCard>

      {blocked.length > 0 && (
        <SectionCard title="Blocked items — kept visible" description="Blocked is a coverage limitation. It is not a clean check and not an absence of regulation.">
          <ul className="divide-y divide-border">
            {blocked.map((q) => (
              <li key={q.id} className="flex items-start gap-2 px-4 py-2">
                <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700" />
                <div>
                  <div className="text-[12px] font-medium text-slate-900">{q.jurisdiction_name}</div>
                  <div className="text-[11.5px] leading-snug text-slate-600">{q.block_reason || q.coverage_gaps || q.status}</div>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Batch history" description="Each batch records its trigger, batch limit, outputs and estimated AI usage. Estimates are app-side, not billing figures.">
        <DataTable
          loading={loading}
          rows={runs.filter((r) => r.run_kind !== "Collector self-test")}
          columns={[
            { key: "run_ref", header: "Run", render: (r) => <span className="font-mono text-[11px] text-slate-600">{r.run_ref}</span> },
            { key: "run_kind", header: "Kind", render: (r) => <span className="text-[11.5px]">{r.run_kind}</span> },
            { key: "trigger_type", header: "Trigger", render: (r) => <StatusBadge tone={r.trigger_type === "Workflow" ? "info" : "neutral"} dot={false}>{r.trigger_type}</StatusBadge> },
            { key: "status", header: "Status", render: (r) => <StatusBadge tone={RUN_TONE[r.status] || "unknown"}>{r.status}</StatusBadge> },
            { key: "processed", header: "Processed", render: (r) => <span className="num text-[11.5px]">{r.processed || 0}</span> },
            { key: "out", header: "Output", render: (r) => <span className="num text-[11.5px]">{r.candidates_created || 0} candidate(s) · {r.drafts_created || 0} draft(s)</span> },
            { key: "usage", header: "AI usage", render: (r) => <span className="num text-[11.5px]">{r.llm_calls || 0} call(s) · ~{r.credits_estimated || 0} credits</span> },
            { key: "when", header: "Finished", render: (r) => <span className="num text-[10.5px] text-slate-500">{r.finished_at ? fmtDateTime(r.finished_at) : "running"}</span> },
            { key: "notes", header: "Note", render: (r) => <span className="max-w-[300px] text-[11px] leading-snug text-slate-600">{r.notes || "—"}</span> },
          ]}
          empty={<EmptyState icon={ListChecks} title="No batch has run yet" description="Run a batch to research the next jurisdictions in the queue." />}
        />
      </SectionCard>
    </div>
  );
}