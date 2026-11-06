import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { callFunction, logAudit } from "@/lib/audit";
import DataTable from "@/components/DataTable";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { fmtDateTime } from "@/lib/format";
import { BookOpen, PlayCircle } from "lucide-react";

const CELL_TONE = {
  "Not started": "unknown",
  "Queued": "info",
  "Researching": "info",
  "Drafts available": "warning",
  "Awaiting review": "warning",
  'Drafts prepared': 'info',
  'Awaiting source verification': 'warning',
  'Awaiting applicability/requirement review': 'warning',
  "Reviewed within stated scope": "success",
  "Blocked — no official instrument located": "danger",
  "Blocked — retrieval failed": "danger",
  "Blocked — budget or usage limit": "danger",
};

const CATEGORIES = ["A. Market Entry & Legal", "B. Slots Technical", "C. Live Casino Game Technical", "D. Live Studio & Operational"];

export default function BaselineMatrix() {
  const [cells, setCells] = useState([]);
  const [runs, setRuns] = useState([]);
  const [counts, setCounts] = useState({});
  const [draftsTotal, setDraftsTotal] = useState(0);
  const [cursor, setCursor] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(3);

  const load = useCallback(async () => {
    const [cPage, rPage, totals, draftCount] = await Promise.all([
      base44.entities.RequirementBaseline.filter(category ? { category } : {}, { sort: 'jurisdiction_id', limit: 40, cursor: cursor || undefined }),
      base44.entities.DiscoveryRun.filter({ run_kind: 'Requirements baseline research' }, { sort: '-created_date', limit: 30 }),
      base44.entities.RequirementBaseline.aggregate({ groupBy: 'status' }),
      base44.entities.Requirement.count({ ai_generated: true, is_fixture: { $ne: true } }),
    ]);
    setCells(cPage.items || []);
    setNextCursor(cPage.has_more ? cPage.next_cursor : '');
    setRuns(rPage.items || []);
    setCounts(Object.fromEntries(totals.rows.map(r => [r.status, r.count])));
    setDraftsTotal(draftCount);
    setLoading(false);
  }, [category, cursor]);

  useEffect(() => { load(); }, [load]);

  const research = async () => {
    setBusy(true);
    setMessage("Researching the next baseline cells — official instruments are being retrieved and tested.");
    try {
      const result = await callFunction("runRequirementResearch", { limit, category: category || undefined, trigger_type: "Manual" });
      if (result?.error) throw new Error(result.error);
      if (result?.blocked) setMessage(`Research did not run: ${result.reason}`);
      else if (result?.message) setMessage(result.message);
      else setMessage(`${result.run_ref}: researched ${result.processed} cell(s), ${result.drafts_created} draft requirement(s) created — all unreviewed.`);
      await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const sendForReview = async (cell) => {
    setBusy(true);
    try {
      const result = await callFunction("requirementWrite", { op: "sendForReview", jurisdiction_id: cell.jurisdiction_id, jurisdiction_name: cell.jurisdiction_name, category: cell.category });
      if (result?.error) throw new Error(result.error);
      await logAudit({ eventType: "Baseline drafts sent for review", entityType: "Requirement", entityLabel: `${cell.jurisdiction_name} — ${cell.category}`, summary: `${result.moved} draft requirement(s) moved to review.` });
      setMessage(`${result.moved} draft(s) for ${cell.jurisdiction_name} (${cell.category}) are now in review — no approval was recorded.`);
      await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const byJurisdiction = useMemo(() => {
    const map = new Map();
    for (const cell of cells) {
      if (!map.has(cell.jurisdiction_id)) {
        map.set(cell.jurisdiction_id, {
          jurisdiction_id: cell.jurisdiction_id,
          jurisdiction_name: cell.jurisdiction_name,
          internal_classification: cell.internal_classification,
          priority_rank: cell.priority_rank,
          cells: {},
        });
      }
      map.get(cell.jurisdiction_id).cells[cell.category] = cell;
    }
    return Array.from(map.values()).sort((a, b) => (a.priority_rank || 9) - (b.priority_rank || 9) || String(a.jurisdiction_name).localeCompare(String(b.jurisdiction_name)));
  }, [cells]);

  const totalCells = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const filteredRows = useMemo(() => byJurisdiction.filter((row) => !category || row.cells[category]), [byJurisdiction, category]);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Requirements baseline research — four categories, whole register"
        description="A separate, resumable queue from monitoring. Every draft is a candidate: official wording, internal interpretation and implementation action are kept apart, and company-specific applicability stays unresolved."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={category} onChange={(e) => { setCategory(e.target.value); setCursor(''); }} className="h-8 rounded-sm border border-border bg-white px-2 text-[12px]">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-8 rounded-sm border border-border bg-white px-2 text-[12px]">
              {[2, 3, 4].map((n) => <option key={n} value={n}>{n} cells per batch</option>)}
            </select>
            <button type="button" onClick={research} disabled={busy} className="inline-flex items-center gap-1.5 rounded-sm bg-slate-900 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
              <PlayCircle className="h-3.5 w-3.5" /> Research next batch
            </button>
          </div>
        }
      >
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Cells in matrix", totalCells, "jurisdiction × category, excludes held source rows"],
            ["Not started", counts["Not started"] || 0, "no research yet"],
            ["Awaiting source verification", counts['Awaiting source verification'] || 0, 'provisional source material'],
            ["Awaiting requirement review", (counts['Awaiting applicability/requirement review'] || 0) + (counts['Awaiting review'] || 0) + (counts['Drafts available'] || 0), 'not completed category coverage'],
            ["Blocked / no instrument", (counts["Blocked — no official instrument located"] || 0) + (counts["Blocked — retrieval failed"] || 0), "gap, not “no requirement”"],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-white px-4 py-3">
              <div className="num text-[19px] font-semibold text-slate-900">{value}</div>
              <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
              <div className="text-[11px] text-muted-foreground">{note}</div>
            </div>
          ))}
        </div>

        {message && <div className="border-b border-border bg-green-50/60 px-4 py-2 text-[12px] text-green-900">{message}</div>}

        <div className="border-b border-border px-4 py-2 text-[11.5px] text-slate-600">
          Initial backlog continuation runs separately from weekly maintenance. Source verification and applicability review remain separate human stages; finding drafts never completes a category. Unfound requirements are gaps, never “no requirement”.
        </div>

        <DataTable
          loading={loading}
          rows={filteredRows}
          rowKey="jurisdiction_id"
          columns={[
            {
              key: "jurisdiction_name",
              header: "Jurisdiction",
              render: (row) => (
                <div>
                  <div className="font-medium text-slate-900">{row.jurisdiction_name}</div>
                  <div className="text-[10.5px] text-muted-foreground">{row.internal_classification}</div>
                </div>
              ),
            },
            ...CATEGORIES.map((cat) => ({
              key: cat,
              header: cat.replace(/^[A-D]\. /, ""),
              render: (row) => {
                const cell = row.cells[cat];
                if (!cell) return <span className="text-[11px] text-slate-300">—</span>;
                return (
                  <div className="space-y-1">
                    <StatusBadge tone={CELL_TONE[cell.status] || "unknown"} dot={false}>{cell.status}</StatusBadge>
                    <div className="text-[10.5px] text-muted-foreground">{cell.drafts_count || 0} draft(s) · coverage incomplete unless reviewed within stated scope</div>
                    {(cell.gaps || cell.block_reason) && <details className="max-w-xs text-xs text-muted-foreground"><summary>Scope & gaps</summary>{cell.block_reason} {cell.gaps}</details>}
                    {(cell.status === "Drafts available" || cell.status === "Awaiting review") && (
                      <button type="button" onClick={() => sendForReview(cell)} disabled={busy || cell.status !== "Drafts available"} className="text-[10.5px] text-green-800 underline disabled:opacity-40">
                        Send drafts to review
                      </button>
                    )}
                  </div>
                );
              },
            })),
          ]}
          empty={<EmptyState icon={BookOpen} title="No cells on this page" description="Refresh the discovery queue if the baseline has not been seeded." />}
        />
        <div className="flex gap-4 border-t border-border p-3 text-xs"><button type="button" onClick={() => setCursor('')} className="underline">First page</button><button type="button" disabled={!nextCursor || loading} onClick={() => setCursor(nextCursor)} className="underline disabled:opacity-40">Next cells</button><span className="text-muted-foreground">{draftsTotal} AI-assisted drafts on file; displayed cells are one page. Finding drafts is not category completion.</span></div>
      </SectionCard>

      <SectionCard title="Baseline research batches" description="Separate from monitoring and from source discovery. Each batch records its usage estimate and explicit gaps.">
        <DataTable
          loading={loading}
          rows={runs}
          columns={[
            { key: "run_ref", header: "Run", render: (r) => <span className="font-mono text-[11px] text-slate-600">{r.run_ref}</span> },
            { key: "trigger_type", header: "Trigger", render: (r) => <StatusBadge tone={r.trigger_type === "Workflow" ? "info" : "neutral"} dot={false}>{r.trigger_type}</StatusBadge> },
            { key: "status", header: "Status", render: (r) => <StatusBadge tone={r.status === "Completed" ? "success" : r.status === "Partially completed" ? "warning" : "danger"}>{r.status}</StatusBadge> },
            { key: "processed", header: "Cells", render: (r) => <span className="num text-[11.5px]">{r.processed || 0}</span> },
            { key: "drafts", header: "Drafts", render: (r) => <span className="num text-[11.5px]">{r.drafts_created || 0}</span> },
            { key: "usage", header: "AI usage", render: (r) => <span className="num text-[11.5px]">{r.llm_calls || 0} call(s) · ~{r.credits_estimated || 0} credits</span> },
            { key: "finished", header: "Finished", render: (r) => <span className="num text-[10.5px] text-slate-500">{r.finished_at ? fmtDateTime(r.finished_at) : "running"}</span> },
            { key: "notes", header: "Note", render: (r) => <span className="max-w-[300px] text-[11px] leading-snug text-slate-600">{r.failures || r.notes || "—"}</span> },
          ]}
          empty={<EmptyState icon={BookOpen} title="No baseline batch yet" description="Research the next cells to create unreviewed draft requirements from official instruments." />}
        />
      </SectionCard>
    </div>
  );
}