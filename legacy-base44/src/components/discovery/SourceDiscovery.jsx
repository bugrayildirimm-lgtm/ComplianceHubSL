import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { callFunction, logAudit } from "@/lib/audit";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import { VERIFICATION_TONE, fmtDateTime } from "@/lib/format";
import { Search } from "lucide-react";

export default function SourceDiscovery() {
  const [sources, setSources] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);

  const load = useCallback(async () => {
    const [sourcePage, jPage] = await Promise.all([
      base44.entities.Source.list({ sort: "-created_date", limit: 500 }),
      base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 }),
    ]);
    setSources(sourcePage.items || []);
    setJurisdictions(jPage.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sources
      .filter((s) => s.verification_status === "Awaiting source verification")
      .filter((s) => !term || [s.jurisdiction_name, s.authority, s.url].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
  }, [sources, search]);

  const covered = new Set(sources.map((s) => s.jurisdiction_id));
  const uncovered = jurisdictions.filter((j) => !covered.has(j.jurisdiction_id));

  const runDiscovery = async () => {
    setBusy(true);
    setMessage("Searching official sources… this can take a few moments per jurisdiction.");
    try {
      const result = await callFunction("discoverSources", target ? { jurisdiction_ids: [target], limit: 1 } : { limit: 2 });
      if (result?.error) throw new Error(result.error);
      setMessage(result.message || `Proposed ${result.created} candidate source(s) across ${result.jurisdictions_processed} jurisdiction(s). ${result.failures?.length ? `${result.failures.length} jurisdiction(s) failed.` : ""}`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (ids, action) => {
    setBusy(true);
    try {
      const statement = action === "verify"
        ? window.prompt("Confirm the publisher and the topics this source really covers (required, at least 25 characters).")
        : window.prompt("Why are these candidates rejected?");
      if (!statement) { setBusy(false); return; }
      const result = await callFunction("sourceReview", { op: action === "verify" ? "verify" : "reject", source_ids: ids, evidence: statement, reason: statement });
      if (result?.error) throw new Error(result.error);
      if (result.refused?.length) setMessage(`${result.decided.length} recorded; refused: ${result.refused.map((r) => r.reason).join("; ")}`);
      setSelected([]);
      setMessage(`${ids.length} source(s) ${action === "verify" ? "verified" : "rejected"}.`);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Official-source discovery"
        description="AI proposes candidate sources per jurisdiction; publishing authority must be confirmed by a person before collection. Search snippets, media and law-firm summaries are never accepted as evidence."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 max-w-[240px] rounded-sm border border-border bg-white px-2 text-[12px]">
              <option value="">Auto: next uncovered jurisdictions</option>
              {jurisdictions.map((j) => <option key={j.id} value={j.jurisdiction_id}>{j.name}</option>)}
            </select>
            <button type="button" onClick={runDiscovery} disabled={busy || !jurisdictions.length} className="rounded-sm bg-slate-900 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
              {busy ? "Working…" : "Propose sources"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {[
            ["Jurisdictions", jurisdictions.length, "in the master register"],
            ["With at least one source", covered.size, "proposed or verified"],
            ["Awaiting verification", candidates.length, "batch review queue"],
            ["No source at all", uncovered.length, "discovery needed"],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-white px-4 py-3">
              <div className="num text-[18px] font-semibold text-slate-900">{value}</div>
              <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
              <div className="text-[11px] text-muted-foreground">{note}</div>
            </div>
          ))}
        </div>
        {message && <div className="border-t border-border bg-green-50/50 px-4 py-2 text-[12px] text-green-900">{message}</div>}
        {!jurisdictions.length && (
          <div className="border-t border-border px-4 py-2 text-[11.5px] text-amber-800">
            Import the jurisdiction register first — discovery works through the register, not a fixed pilot list.
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={`${candidates.length} candidate source${candidates.length === 1 ? "" : "s"}`}
        actions={selected.length > 0 && (
          <div className="flex gap-2">
            <button type="button" onClick={() => decide(selected, "verify")} disabled={busy} className="rounded-sm bg-green-800 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">Verify selected</button>
            <button type="button" onClick={() => decide(selected, "reject")} disabled={busy} className="rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700">Reject</button>
          </div>
        )}
      >
        <FilterBar search={search} onSearch={setSearch} placeholder="Search candidates…" />
        <DataTable
          loading={loading}
          rows={candidates}
          rowKey="id"
          columns={[
            {
              key: "select",
              header: "",
              width: "32px",
              render: (s) => (
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) => setSelected((current) => (e.target.checked ? [...current, s.id] : current.filter((id) => id !== s.id)))}
                />
              ),
            },
            { key: "jurisdiction_name", header: "Jurisdiction", render: (s) => <span className="font-medium text-slate-900">{s.jurisdiction_name}</span> },
            {
              key: "authority",
              header: "Proposed authority",
              render: (s) => (
                <div className="min-w-0">
                  <div className="text-slate-900">{s.authority}</div>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="block max-w-[380px] truncate font-mono text-[11px] text-green-800 hover:underline">{s.url}</a>
                </div>
              ),
            },
            { key: "source_type", header: "Type", render: (s) => <span className="text-[11.5px]">{s.source_type} · {s.language}</span> },
            { key: "verification_evidence", header: "Verification evidence (AI-assisted, unconfirmed)", render: (s) => <span className="block max-w-[380px] text-[11px] leading-snug text-slate-600">{s.verification_evidence || "None recorded"}</span> },
            { key: "verification_status", header: "Status", render: (s) => <StatusBadge tone={VERIFICATION_TONE[s.verification_status] || "unknown"}>{s.verification_status}</StatusBadge> },
            { key: "discovered", header: "Discovered", render: (s) => <span className="num text-[11px] text-slate-500">{fmtDateTime(s.created_date)}<br />{s.discovered_by}</span> },
            {
              key: "actions",
              header: "",
              render: (s) => (
                <div className="flex gap-1">
                  <button type="button" onClick={() => decide([s.id], "verify")} disabled={busy} className="rounded-sm border border-border px-1.5 py-1 text-[11px] text-slate-700">Verify</button>
                  <button type="button" onClick={() => decide([s.id], "reject")} disabled={busy} className="rounded-sm border border-border px-1.5 py-1 text-[11px] text-slate-700">Reject</button>
                </div>
              ),
            },
          ]}
          empty={<EmptyState icon={Search} title="No candidates awaiting review" description="Propose sources for uncovered jurisdictions — every proposal lands here for batch verification before any collection runs." />}
        />
      </SectionCard>
    </div>
  );
}