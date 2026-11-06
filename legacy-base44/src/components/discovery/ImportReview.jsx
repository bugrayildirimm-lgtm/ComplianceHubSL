import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { callFunction } from "@/lib/audit";
import { csvToObjects } from "@/lib/csv";
import seedCsv from "@/data/jurisdiction_import_seed.csv?raw";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { fmtDateTime } from "@/lib/format";
import { AlertTriangle, FileUp, Upload } from "lucide-react";

const VALIDATION_TONE = { Valid: "success", Warning: "warning", "Possible duplicate": "warning", Invalid: "danger", "Already imported": "neutral" };
const DECISIONS = ["Pending review", "Approved for promotion", "On hold", "Rejected"];

export default function ImportReview() {
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadRows = useCallback(async (id) => {
    if (!id) { setRows([]); return; }
    const list = await base44.entities.ImportRow.filter({ batch_id: id });
    setRows((list || []).sort((a, b) => Number(a.source_row || 0) - Number(b.source_row || 0)));
  }, []);

  const load = useCallback(async () => {
    const page = await base44.entities.ImportBatch.list({ sort: "-created_date", limit: 20 });
    const items = page.items || [];
    setBatches(items);
    const active = batchId || items[0]?.id || null;
    setBatchId(active);
    await loadRows(active);
    setLoading(false);
  }, [batchId, loadRows]);

  useEffect(() => { load(); }, [load]);

  const runImport = async (csvText, fileName, sheetName) => {
    setBusy(true);
    setMessage("");
    try {
      const { objects } = csvToObjects(csvText);
      if (!objects.length) throw new Error("No rows found in that file.");
      const result = await callFunction("importStaging", { file_name: fileName, sheet_name: sheetName, rows: objects });
      if (result?.error) throw new Error(result.error);
      setMessage(`Preview ${result.batch_ref}: ${result.counts.total} rows staged — ${result.counts.valid} valid, ${result.counts.warning} flagged, ${result.counts.duplicate} possible duplicates, ${result.counts.already} already imported.`);
      setBatchId(result.batch_id);
      await loadRows(result.batch_id);
      const page = await base44.entities.ImportBatch.list({ sort: "-created_date", limit: 20 });
      setBatches(page.items || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await runImport(text, file.name, "Import_Staging");
    event.target.value = "";
  };

  const setDecision = async (row, decision) => {
    await base44.entities.ImportRow.update(row.id, { review_decision: decision });
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, review_decision: decision } : r)));
  };

  const bulkDecide = async (decision, includePossibleDuplicates = false) => {
    setBusy(true);
    try {
      const targets = rows.filter((row) => {
        if (row.promoted_jurisdiction_id) return false;
        if (row.validation_status === "Invalid" || row.validation_status === "Already imported") return false;
        if (row.validation_status === "Possible duplicate" && !includePossibleDuplicates) return false;
        return row.review_decision !== decision;
      });
      if (targets.length) {
        await base44.entities.ImportRow.bulkUpdate(targets.map((row) => ({ id: row.id, review_decision: decision })));
      }
      await loadRows(batchId);
      setMessage(`${targets.length} row(s) set to "${decision}".`);
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await callFunction("promoteImportRows", { batch_id: batchId });
      if (result?.error) throw new Error(result.error);
      setMessage(`Promoted ${result.promoted} row(s) into the master register (${result.created.length} new, ${result.updated.length} updated).`);
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => rows.reduce((acc, row) => {
    acc[row.validation_status] = (acc[row.validation_status] || 0) + 1;
    if (row.promoted_jurisdiction_id) acc.promoted = (acc.promoted || 0) + 1;
    if (row.review_decision === "Approved for promotion" && !row.promoted_jurisdiction_id) acc.approved = (acc.approved || 0) + 1;
    return acc;
  }, {}), [rows]);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Jurisdiction register import"
        description="Import_Staging only. import_row_key blocks repeat-file duplication; promotion into the master register is a separate, controlled step."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runImport(seedCsv, "Stakelogic_Jurisdiction_Import_Seed.xlsx", "Import_Staging")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-sm bg-slate-900 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
              <Upload className="h-3.5 w-3.5" /> Load seed register (112 rows)
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700">
              <FileUp className="h-3.5 w-3.5" /> Upload CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </label>
          </div>
        }
      >
        {batches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <span className="text-[11.5px] text-slate-600">Batch</span>
            <select
              value={batchId || ""}
              onChange={async (e) => { setBatchId(e.target.value); await loadRows(e.target.value); }}
              className="h-8 rounded-sm border border-border bg-white px-2 text-[12.5px]"
            >
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batch_ref} · {batch.file_name} · {batch.status}
                </option>
              ))}
            </select>
            {batches.find((b) => b.id === batchId) && (
              <span className="text-[11.5px] text-muted-foreground">
                {fmtDateTime(batches.find((b) => b.id === batchId).created_date)} · {batches.find((b) => b.id === batchId).status}
              </span>
            )}
          </div>
        )}

        {message && <div className="border-b border-border bg-green-50/50 px-4 py-2 text-[12px] text-green-900">{message}</div>}

        {!batches.length ? (
          <EmptyState
            icon={FileUp}
            title="No import preview yet"
            description="Load the Import_Staging sheet from the seed workbook, or upload a CSV export. Nothing is written to the master register until you approve and promote rows."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Rows in preview", rows.length],
                ["Valid", counts.Valid || 0],
                ["Flagged", counts.Warning || 0],
                ["Possible duplicates", counts["Possible duplicate"] || 0],
                ["Approved to promote", counts.approved || 0],
                ["Already promoted", counts.promoted || 0],
              ].map(([label, value]) => (
                <div key={label} className="bg-white px-3 py-2.5">
                  <div className="num text-[17px] font-semibold text-slate-900">{value}</div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <button type="button" onClick={() => bulkDecide("Approved for promotion")} disabled={busy} className="rounded-sm bg-green-800 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
                Approve all valid rows
              </button>
              <button type="button" onClick={() => bulkDecide("Approved for promotion", true)} disabled={busy} className="rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700">
                Include possible duplicates
              </button>
              <button type="button" onClick={() => bulkDecide("On hold")} disabled={busy} className="rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700">
                Put unresolved on hold
              </button>
              <button type="button" onClick={promote} disabled={busy || !counts.approved} className="ml-auto rounded-sm bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                Promote approved rows ({counts.approved || 0})
              </button>
            </div>

            <div className="flex items-start gap-2 border-b border-border bg-amber-50/60 px-4 py-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
              <p className="text-[11.5px] leading-relaxed text-amber-900">
                Possible duplicates are never merged silently, and an internal classification never creates a licence. Aggregates such as
                "Canada (Rest of)" and ambiguous names such as "Bosnia" stay flagged for a person to clarify the territorial scope.
              </p>
            </div>

            <DataTable
              loading={loading}
              rows={rows}
              rowKey="id"
              columns={[
                { key: "source_row", header: "Row", width: "56px", render: (r) => <span className="font-mono text-[11px] text-slate-500">{r.source_row}</span> },
                {
                  key: "name",
                  header: "Jurisdiction",
                  render: (r) => (
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{r.jurisdiction_name_trimmed}</div>
                      {r.jurisdiction_name_raw !== r.jurisdiction_name_trimmed && (
                        <div className="text-[11px] text-amber-700">original: "{r.jurisdiction_name_raw}"</div>
                      )}
                      <div className="font-mono text-[10.5px] text-slate-400">{r.import_row_key}</div>
                    </div>
                  ),
                },
                { key: "proposed_internal_status", header: "Classification", render: (r) => <span className="text-[11.5px]">{r.proposed_internal_status}</span> },
                { key: "validation_status", header: "Validation", render: (r) => <StatusBadge tone={VALIDATION_TONE[r.validation_status] || "unknown"} dot={false}>{r.validation_status}</StatusBadge> },
                {
                  key: "notes",
                  header: "Validation notes",
                  render: (r) => (
                    <ul className="max-w-[420px] list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-slate-600">
                      {(r.validation_notes || []).map((note, i) => <li key={i}>{note}</li>)}
                      {!r.validation_notes?.length && <li className="list-none text-slate-400">—</li>}
                    </ul>
                  ),
                },
                {
                  key: "decision",
                  header: "Review decision",
                  render: (r) => (
                    r.promoted_jurisdiction_id ? (
                      <div className="text-[11.5px]">
                        <div className="font-medium text-emerald-700">{r.promoted_jurisdiction_id}</div>
                        <div className="text-muted-foreground">in master register</div>
                      </div>
                    ) : (
                      <select
                        value={r.review_decision}
                        onChange={(e) => setDecision(r, e.target.value)}
                        disabled={r.validation_status === "Invalid" || r.validation_status === "Already imported"}
                        className="h-7 rounded-sm border border-border bg-white px-1.5 text-[11.5px] disabled:opacity-40"
                      >
                        {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    )
                  ),
                },
              ]}
              empty={<EmptyState icon={FileUp} title="This batch has no rows" description="Load a file to stage rows for review." />}
            />
          </>
        )}
      </SectionCard>
    </div>
  );
}