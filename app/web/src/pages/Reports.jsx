import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { callFunction } from "@/lib/audit";
import PageHeader from "@/components/PageHeader";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Download, FileBarChart2 } from "lucide-react";

const SECTION_LABELS = {
  monitoring_coverage: "Monitoring coverage",
  developments: "Detected developments",
  review_decisions: "Review decisions",
  requirements: "Requirement changes",
  deadlines: "Upcoming deadlines and overdue actions",
  unresolved_gaps: "Unresolved gaps",
};

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const page = await base44.entities.Report.list({ sort: "-created_date", limit: 40 });
    const items = page.items || [];
    setReports(items);
    setSelected((current) => current || items[0] || null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await callFunction("generateReport", {});
      if (result?.error) throw new Error(result.error);
      setMessage(`Report ${result.report.report_ref} generated.`);
      setSelected(result.report);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const exportJson = () => {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selected.report_ref}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sections = selected?.sections_json ? JSON.parse(selected.sections_json) : null;

  return (
    <>
      <PageHeader
        eyebrow="Reporting"
        title="Reports"
        description="Month-end reporting is generated from recorded jobs, documents, decisions and deadlines — no repeat searching, and no claim of completeness."
        actions={
          <button type="button" onClick={generate} disabled={busy} className="rounded-sm bg-slate-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-slate-800 disabled:opacity-40">
            {busy ? "Generating…" : "Generate month-end report"}
          </button>
        }
      />

      {message && <div className="mb-4 rounded-md border border-border bg-white px-3.5 py-2 text-[12px] text-slate-700">{message}</div>}

      <div className="grid gap-5 xl:grid-cols-4">
        <SectionCard title="Generated reports" className="xl:col-span-1">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-sm bg-slate-100" />)}</div>
          ) : reports.length === 0 ? (
            <EmptyState icon={FileBarChart2} title="No reports yet" description="Generate the first report to see monitoring coverage, developments and gaps for the current month." />
          ) : (
            <ul className="divide-y divide-border">
              {reports.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(report)}
                    className={`w-full px-4 py-2.5 text-left text-[12px] transition-colors hover:bg-slate-50 ${selected?.id === report.id ? "bg-green-50/60" : ""}`}
                  >
                    <div className="font-medium text-slate-900">{report.report_ref}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtDate(report.period_start)} → {fmtDate(report.period_end)}</div>
                    <div className="text-[10.5px] text-slate-400">generated {fmtDateTime(report.generated_at)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="space-y-5 xl:col-span-3">
          {!selected ? (
            <SectionCard title="Report">
              <EmptyState icon={FileBarChart2} title="Nothing selected" description="Choose a report or generate a new one." />
            </SectionCard>
          ) : (
            <>
              <SectionCard
                title={`${selected.report_ref} · ${fmtDate(selected.period_start)} → ${fmtDate(selected.period_end)}`}
                description={selected.summary}
                actions={
                  <button type="button" onClick={exportJson} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700">
                    <Download className="h-3.5 w-3.5" /> Export
                  </button>
                }
                footer={<p className="text-[11px] leading-relaxed text-slate-600">{selected.scope_note}</p>}
              >
                <div className="px-4 py-2 text-[11.5px] text-muted-foreground">
                  Generated by {selected.generated_by || "system"} · stored, not recalculated on view
                </div>
              </SectionCard>

              {sections && Object.entries(sections).filter(([key]) => SECTION_LABELS[key]).map(([key, value]) => (
                <SectionCard key={key} title={SECTION_LABELS[key]}>
                  <SectionBody value={value} />
                </SectionCard>
              ))}

              {!sections && (
                <SectionCard title="Report content">
                  <p className="px-4 py-3 text-[12px] text-slate-600">This report has no structured content stored.</p>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SectionBody({ value }) {
  if (value === null || value === undefined) return <p className="px-4 py-3 text-[12px] text-slate-500">Not recorded.</p>;
  if (typeof value !== "object") return <p className="px-4 py-3 text-[12.5px] text-slate-800">{String(value)}</p>;

  if (Array.isArray(value)) {
    if (!value.length) return <p className="px-4 py-3 text-[12px] text-slate-500">None recorded in this period.</p>;
    return (
      <ul className="divide-y divide-border">
        {value.map((item, index) => (
          <li key={index} className="px-4 py-2 text-[12px] text-slate-700">
            {typeof item === "object" ? (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(item).map(([k, v]) => (
                  <span key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</span>
                ))}
              </div>
            ) : String(item)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="divide-y divide-border">
      {Object.entries(value).map(([key, val]) => (
        <div key={key} className="flex flex-col gap-1 px-4 py-2 sm:flex-row sm:items-start sm:justify-between">
          <span className="text-[11.5px] capitalize text-muted-foreground">{key.replace(/_/g, " ")}</span>
          <div className="text-right text-[12px] text-slate-800 sm:max-w-[60%]">
            {Array.isArray(val) ? (
              val.length ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {val.slice(0, 12).map((item, i) => (
                    <span key={i} className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-700">
                      {typeof item === "object" ? JSON.stringify(item) : String(item)}
                    </span>
                  ))}
                  {val.length > 12 && <span className="text-[10.5px] text-slate-500">+{val.length - 12} more</span>}
                </div>
              ) : <span className="text-slate-500">None</span>
            ) : typeof val === "object" && val !== null ? (
              <div className="flex flex-wrap justify-end gap-1">
                {Object.entries(val).map(([k, v]) => (
                  <StatusBadge key={k} tone="neutral" dot={false}>{k}: {String(v)}</StatusBadge>
                ))}
              </div>
            ) : (
              String(val)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}