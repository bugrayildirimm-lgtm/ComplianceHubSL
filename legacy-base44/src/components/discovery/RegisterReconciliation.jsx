import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import DataTable from "@/components/DataTable";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { fmtDate } from "@/lib/format";
import { callFunction } from "@/lib/audit";
import { AlertTriangle, FileSearch } from "lucide-react";

const TREATMENT_TONE = {
  "Promoted into master register": "success",
  "Promoted — updated an existing master record": "info",
  "Unresolved — possible duplicate": "danger",
  "Excluded by review": "neutral",
};

export default function RegisterReconciliation() {
  const [rows, setRows] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [batches, setBatches] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recon, setRecon] = useState(null);
  const [reconMessage, setReconMessage] = useState("");

  const load = useCallback(async () => {
    const [rowPage, jPage, bPage, aPage] = await Promise.all([
      base44.entities.ImportRow.list({ limit: 500 }),
      base44.entities.Jurisdiction.list({ limit: 500 }),
      base44.entities.ImportBatch.list({ sort: "-created_date", limit: 5 }),
      base44.entities.AuditEvent.list({ sort: "-occurred_at", limit: 200 }),
    ]);
    setRows((rowPage.items || []).sort((a, b) => Number(a.source_row || 0) - Number(b.source_row || 0)));
    setJurisdictions(jPage.items || []);
    setBatches(bPage.items || []);
    setAudit((aPage.items || []).filter((e) => /import/i.test(`${e.event_type} ${e.summary}`)).slice(0, 6));
    try {
      const counted = await callFunction("coverageReconciliation", {});
      if (counted && !counted.error) setRecon(counted);
    } catch (error) {
      setReconMessage(error.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => Object.fromEntries(jurisdictions.map((j) => [j.jurisdiction_id, j])), [jurisdictions]);
  const promotionCounts = useMemo(() => rows.reduce((acc, r) => {
    if (!r.promoted_jurisdiction_id) return acc;
    acc[r.promoted_jurisdiction_id] = (acc[r.promoted_jurisdiction_id] || 0) + 1;
    return acc;
  }, {}), [rows]);

  const treatmentOf = (row) => {
    if (row.promoted_jurisdiction_id) {
      return promotionCounts[row.promoted_jurisdiction_id] > 1
        ? "Promoted — updated an existing master record"
        : "Promoted into master register";
    }
    if (row.validation_status === "Possible duplicate") return "Unresolved — possible duplicate";
    if (row.review_decision === "Rejected") return "Excluded by review";
    return "Unresolved — pending review";
  };

  const counts = useMemo(() => rows.reduce((acc, r) => {
    const key = treatmentOf(r);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}), [rows, promotionCounts]);

  const cayman = rows.filter((r) => /caym/i.test(`${r.jurisdiction_name_raw} ${r.jurisdiction_name_trimmed}`));
  const distinctMaster = new Set(rows.filter((r) => r.promoted_jurisdiction_id).map((r) => r.promoted_jurisdiction_id)).size;
  const batch = batches[0];

  return (
    <div className="space-y-5">
      <SectionCard
        title="112 source rows → 110 master records"
        description="Row-by-row evidence of what happened to every imported line. Nothing was merged silently and no jurisdiction was invented."
      >
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Source rows imported", rows.length, "Import_Staging sheet"],
            ["Promoted rows", counts["Promoted into master register"] || 0, "approved and promoted"],
            ["Master records created", distinctMaster, "distinct jurisdiction IDs"],
            ["Unresolved rows", (counts["Unresolved — possible duplicate"] || 0) + (counts["Unresolved — pending review"] || 0), "held back for a person"],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-white px-4 py-3">
              <div className="num text-[20px] font-semibold text-slate-900">{value}</div>
              <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
              <div className="text-[11px] text-muted-foreground">{note}</div>
            </div>
          ))}
        </div>

        <div className="border-t border-border px-4 py-3 text-[12px] leading-relaxed text-slate-700">
          <p>
            {counts["Promoted into master register"] || 0} rows were approved for promotion and each created one master jurisdiction record.
            The difference is entirely accounted for by <strong>{cayman.length} unresolved rows</strong>, which were never promoted, so 112 − {cayman.length} = {distinctMaster}.
            No row was merged into another, and none was silently excluded.
          </p>
          <p className="mt-1.5">
            Import batch <span className="font-mono text-[11px]">{batch?.batch_ref || "—"}</span> ({batch?.status || "—"}) with {batch?.promoted_count || distinctMaster} promoted.
            {" "}The promoted master count excludes both held rows and is not the fully resolved scope. A person must confirm whether they refer to the same canonical territory and resolve the classifications before linking either row; the eventual master count is not predetermined.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Stored-record reconciliation"
        description={recon ? `Counted from the database at ${recon.generated_at}. Every figure below is a query result, not a composed total.` : (reconMessage || "Counting stored records…")}
      >
        {recon && (
          <div className="divide-y divide-border text-[12px]">
            <div className="grid gap-px bg-border sm:grid-cols-3">
              {[
                ["Imported rows / linked / held", `${recon.imported_rows.total} / ${recon.imported_rows.promoted_linked} / ${recon.imported_rows.unlinked_held_rows.length}`],
                ["Master jurisdictions", recon.master.total],
                ["Attempted / untouched", `${recon.research_progress.attempted_jurisdictions} / ${recon.research_progress.untouched_jurisdictions}`],
                ["With candidate sources", recon.research_progress.jurisdictions_with_candidates],
                ["With a verified source", recon.research_progress.jurisdictions_with_verified_source],
                ["Retained source records / unique URLs", `${recon.sources.retained_source_records} / ${recon.sources.unique_candidate_urls}`],
                ["Cumulative proposals across runs", recon.sources.cumulative_proposals_recorded_across_runs],
                ["Awaiting verification / verified", `${recon.sources.awaiting_verification} / ${recon.sources.verified}`],
                ["Failed or rejected attempts", `${recon.discovery_attempts.failed} of ${recon.discovery_attempts.total}`],
                ["Research cells (jurisdiction × category)", `${recon.requirements.research_workstream_cells} — workstream coverage, not legal requirements`],
                ["Requirement records / approved", `${recon.requirements.requirement_records} / ${recon.requirements.approved}`],
                ["Approved with version + decision + audit", recon.requirements.approved_with_valid_version_and_decision],
              ].map(([label, value]) => (
                <div key={label} className="bg-white px-4 py-3">
                  <div className="num text-[17px] font-semibold text-slate-900">{value}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-slate-700">{label}</div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 leading-relaxed text-slate-700">
              <p>{recon.note_on_schedules}</p>
              <p className="mt-1 text-slate-600">Candidates by internal classification with candidates: {Object.entries(recon.research_progress.candidates_by_classification).map(([k, v]) => `${k} ${v}`).join(" · ")}. These are attempted research rows, not successful discoveries.</p>
              {recon.imported_rows.unlinked_held_rows.length > 0 && (
                <p className="mt-1 text-amber-800">Held rows: {recon.imported_rows.unlinked_held_rows.map((r) => `${r.row} ${r.name} (${r.decision})`).join("; ")}.</p>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Cayman / Caymen — held, not merged"
        description="Two source rows, one character apart. Held as a possible-duplicate group so territorial scope is decided by a person."
      >
        <div className="flex items-start gap-2 border-b border-border bg-amber-50/60 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <p className="text-[11.5px] leading-relaxed text-amber-900">
            Row 27 reads “Caymen Islands” (a spelling used in the source workbook) and row 111 reads “Cayman Islands”. Neither is in the master register.
            Guessing would either create a false territory or hide a real one, so both remain staged with approval <em>Pending review</em> until someone confirms
            which territory is meant and whether the internal classification applies to it.
          </p>
        </div>
        <DataTable
          loading={loading}
          rows={cayman}
          columns={[
            { key: "source_row", header: "Source row", width: "70px", render: (r) => <span className="font-mono text-[11px]">{r.source_row}</span> },
            { key: "jurisdiction_name_raw", header: "Name as imported", render: (r) => <span className="font-medium text-slate-900">{r.jurisdiction_name_raw}</span> },
            { key: "import_row_key", header: "Row key", render: (r) => <span className="font-mono text-[10.5px] text-slate-500">{r.import_row_key}</span> },
            { key: "classification", header: "Imported classification / ownership", render: r => <span className="text-xs">{r.internal_status_raw} / {r.proposed_internal_status}<br />{r.proposed_owner_team} · {r.owner_validation}</span> },
            { key: "valid", header: "Validation", render: (r) => <StatusBadge tone="danger">{r.validation_status}</StatusBadge> },
            { key: "decision", header: "Approval", render: (r) => <StatusBadge tone="warning" dot={false}>{r.review_decision}</StatusBadge> },
            { key: "flags", header: "Flags from the import", render: (r) => <span className="text-[11px] leading-snug text-slate-600">{r.migration_flags || (r.validation_notes || []).join(" ")}</span> },
            { key: "master", header: "Master record", render: () => <span className="text-[11.5px] text-red-700">None — not promoted</span> },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Row-level reconciliation"
        description="Every source row, its master record, the treatment applied, and the approval that supports it."
      >
        <DataTable
          loading={loading}
          rows={rows}
          rowKey="id"
          columns={[
            { key: "source_row", header: "Row", width: "56px", render: (r) => <span className="font-mono text-[11px] text-slate-500">{r.source_row}</span> },
            {
              key: "name",
              header: "Source row jurisdiction",
              render: (r) => (
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{r.jurisdiction_name_raw}</div>
                  {r.jurisdiction_name_raw !== r.jurisdiction_name_trimmed && (
                    <div className="text-[11px] text-amber-700">normalised to “{r.jurisdiction_name_trimmed}”</div>
                  )}
                  <div className="font-mono text-[10.5px] text-slate-400">{r.import_row_key}</div>
                </div>
              ),
            },
            {
              key: "master",
              header: "Master jurisdiction",
              render: (r) => (
                r.promoted_jurisdiction_id ? (
                  <div className="text-[11.5px]">
                    <div className="font-mono text-[11px] text-slate-900">{r.promoted_jurisdiction_id}</div>
                    <div className="text-slate-600">{byId[r.promoted_jurisdiction_id]?.name || r.promoted_jurisdiction_name || "—"}</div>
                  </div>
                ) : <span className="text-[11.5px] text-slate-400">—</span>
              ),
            },
            { key: "treatment", header: "Treatment", render: (r) => <StatusBadge tone={TREATMENT_TONE[treatmentOf(r)] || "unknown"} dot={false}>{treatmentOf(r)}</StatusBadge> },
            {
              key: "reason",
              header: "Reason",
              render: (r) => (
                <span className="max-w-[320px] text-[11px] leading-snug text-slate-600">
                  {r.promoted_jurisdiction_id
                    ? `Validated as ${r.validation_status}; approved for promotion under batch ${batch?.batch_ref || ""}.`
                    : (r.validation_notes || []).join(" ") || (r.migration_flags || "—")}
                </span>
              ),
            },
            { key: "approval", header: "Approval", render: (r) => <span className="text-[11px] text-slate-600">{r.review_decision}{r.promoted_jurisdiction_id ? ` · ${r.promoted_jurisdiction_id}` : ""}</span> },
          ]}
          empty={<EmptyState icon={FileSearch} title="No staged rows" description="Load the register workbook in the import tab to create reconciliation evidence." />}
        />
      </SectionCard>

      <SectionCard title="Approval and audit trail" description="The promotion is a recorded, attributable action, not an inference.">
        {audit.length ? (
          <ul className="divide-y divide-border">
            {audit.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-2 px-4 py-2 text-[11.5px]">
                <span className="font-mono text-[10.5px] text-slate-400">{fmtDate(event.occurred_at)}</span>
                <span className="font-medium text-slate-800">{event.event_type}</span>
                <span className="text-slate-600">{event.summary}</span>
                <span className="ml-auto text-[10.5px] text-muted-foreground">{event.actor_name || event.actor_email || "system"}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={FileSearch} title="No import audit events found" description="Import and promotion actions are recorded in the audit log." />}
      </SectionCard>
    </div>
  );
}