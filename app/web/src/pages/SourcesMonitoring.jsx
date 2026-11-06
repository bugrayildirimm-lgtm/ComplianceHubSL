import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { logAudit, callFunction } from "@/lib/audit";
import PageHeader from "@/components/PageHeader";
import FilterBar from "@/components/FilterBar";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { HEALTH_TONES, VERIFICATION_TONE, JOBS_TONE, COVERAGE_TOPICS, fmtDateTime, fromNow } from "@/lib/format";
import HealthAlerts from "@/components/monitoring/HealthAlerts";
import SourceBatchReview from '@/components/monitoring/SourceBatchReview';
import SourceFormatGaps from '@/components/monitoring/SourceFormatGaps';
import TraversalSettings from '@/components/monitoring/TraversalSettings';
import ManagedCapturePanel from '@/components/monitoring/ManagedCapturePanel';
import CollectionScopePanel from '@/components/monitoring/CollectionScopePanel';
import { Activity, PlayCircle } from "lucide-react";

const TABS = [
  { key: "sources", label: "Source registry" },
  { key: 'review', label: 'Batch verification' },
  { key: "jobs", label: "Collection jobs" },
  { key: "coverage", label: "Coverage & honesty" },
];

export default function SourcesMonitoring() {
  const [tab, setTab] = useState("sources");
  const [sources, setSources] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState("");
  const [verification, setVerification] = useState("");
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});
  const [queue, setQueue] = useState([]);
  const [runs, setRuns] = useState([]);
  const [config, setConfig] = useState(null);
  const [pendingPubs, setPendingPubs] = useState(0);

  const load = useCallback(async () => {
    const [sourcePage, jobPage, jPage, qPage, rPage, cPage, pendingCount] = await Promise.all([
      base44.entities.Source.list({ sort: "-created_date", limit: 500 }),
      base44.entities.CollectionJob.list({ sort: "-created_date", limit: 200 }),
      base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 }),
      base44.entities.DiscoveryQueue.list({ limit: 500 }),
      base44.entities.DiscoveryRun.list({ sort: "-created_date", limit: 30 }),
      base44.entities.MonitoringConfig.list({ limit: 5 }),
      base44.entities.CrawlLink.count({ status: "Pending", queue_kind: { $in: ["New publication", "Amendment recheck"] } }),
    ]);
    setPendingPubs(Number(pendingCount) || 0);
    setSources((sourcePage.items || []).filter((s) => !s.is_fixture));
    setJobs(jobPage.items || []);
    setJurisdictions(jPage.items || []);
    setQueue(qPage.items || []);
    setRuns(rPage.items || []);
    setConfig((cPage.items || [])[0] || null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sources.filter((source) => {
      if (health && source.health_status !== health) return false;
      if (verification && source.verification_status !== verification) return false;
      if (!term) return true;
      return [source.jurisdiction_name, source.authority, source.url, (source.topics || []).join(" ")]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [sources, search, health, verification]);

  const verified = sources.filter((s) => s.verification_status === "Verified");
  const awaiting = sources.filter((s) => s.verification_status === "Awaiting source verification");
  const failed = sources.filter((s) => s.health_status === "Failed or blocked");

  const setVerificationFor = async (ids, status) => {
    setBusy(true);
    setMessage("");
    try {
      const statement = status === "Verified"
        ? window.prompt("Your verification statement: name the publishing authority and the topics this source actually covers (required).")
        : window.prompt("Why are these sources rejected?");
      if (!statement) { setBusy(false); return; }
      const result = await callFunction("sourceReview", { op: status === "Verified" ? "verify" : "reject", source_ids: ids, evidence: statement, reason: statement });
      if (result?.error) throw new Error(result.error);
      if (result.refused?.length) setMessage(`${result.decided.length} recorded; ${result.refused.length} refused by the gate: ${result.refused.map((r) => r.reason).join("; ")}`);
      setSelected([]);
      setMessage(`${ids.length} source(s) marked ${status}.`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateSource = async (source, patch) => {
    await callFunction('sourceReview', { op: 'configure', id: source.id, ...patch });
    await logAudit({
      eventType: "Source configuration changed",
      entityType: "Source",
      entityId: source.source_id,
      entityLabel: source.authority,
      summary: `Updated: ${Object.keys(patch).join(", ")}.`,
    });
    load();
  };

  const runNow = async (sourceIds) => {
    setBusy(true);
    setMessage("Collection requested…");
    try {
      const result = await callFunction(
        "collectManaged",
        sourceIds ? { source_ids: sourceIds, trigger: "manual" } : { trigger: "manual" }
      );
      if (result?.error) throw new Error(result.error);
      setMessage(result?.skipped
        ? `No retrieval ran: ${result.reason}`
        : `Cycle ${result.cycle_id}: ${result.checked} source(s) and ${result.publications_processed || 0} publication(s) processed by managed browser — ${result.alerts_created} draft alert(s), ${result.failed} failed. Still outstanding: ${result.outstanding?.due_sources || 0} due source(s), ${result.outstanding?.pending_publications || 0} queued publication(s).`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const addSource = async () => {
    setBusy(true);
    try {
      if (!form.jurisdiction_id || !form.url || !form.authority) throw new Error("Jurisdiction, authority and URL are required.");
      const jurisdiction = jurisdictions.find((j) => j.jurisdiction_id === form.jurisdiction_id);
      await callFunction('sourceReview', { op: 'propose', ...form });
      await logAudit({
        eventType: "Source added",
        entityType: "Source",
        entityId: form.url,
        entityLabel: form.authority,
        summary: `Source proposed for ${jurisdiction?.name || "unknown jurisdiction"}; awaiting verification.`,
      });
      setForm({});
      setShowForm(false);
      setMessage("Source added and awaiting verification.");
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const importedRows = 112;
  const unresolved = jurisdictions.filter((j) => !verified.some((s) => s.jurisdiction_id === j.jurisdiction_id));

  return (
    <>
      <PageHeader
        eyebrow="Monitoring health"
        title="Sources & Monitoring Coverage"
        description="Verification, collection health and topic coverage are reported separately. An imported row is not a monitored jurisdiction."
        actions={
          <button type="button" onClick={() => runNow(null)} disabled={busy || !verified.length} className="inline-flex items-center gap-2 rounded-sm bg-slate-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-slate-800 disabled:opacity-40">
            <PlayCircle className="h-3.5 w-3.5" /> Run due checks
          </button>
        }
      />

      <HealthAlerts config={config} sources={sources} queue={queue} jobs={jobs} runs={runs} pendingPublications={pendingPubs} />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-5">
        {[
          ["Registered sources", sources.length, "proposed or verified"],
          ["Verified", verified.length, "eligible for collection"],
          ["Awaiting verification", awaiting.length, "batch review required"],
          ["Failed or blocked", failed.length, "reported separately"],
          ["Jurisdictions uncovered", unresolved.length, `of ${jurisdictions.length} in register`],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-4 py-3">
            <div className={`num text-[19px] font-semibold ${label === "Failed or blocked" && value > 0 ? "text-red-700" : "text-slate-900"}`}>{value}</div>
            <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
            <div className="text-[11px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </div>
      {message && <div className="mb-4 rounded-md border border-border bg-white px-3.5 py-2 text-[12px] text-slate-700">{message}</div>}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] ${tab === item.key ? "border-green-700 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'review' && <SourceBatchReview onChanged={load} />}
      {tab === "sources" && (
        <SectionCard
          title={`${filtered.length} source${filtered.length === 1 ? "" : "s"}`}
          actions={
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <>
                  <button type="button" onClick={() => setTab('review')} disabled={busy} className="rounded-sm bg-green-800 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">Verify selected</button>
                  <button type="button" onClick={() => setTab('review')} disabled={busy} className="rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700">Reject</button>
                </>
              )}
              <button type="button" onClick={() => setShowForm((v) => !v)} className="rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-700">Add source</button>
            </div>
          }
        >
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Search authority, jurisdiction, URL…"
            filters={[
              { key: "health", label: "Health", value: health, onChange: setHealth, options: Object.keys(HEALTH_TONES) },
              { key: "verification", label: "Verification", value: verification, onChange: setVerification, options: Object.keys(VERIFICATION_TONE) },
            ]}
          />
          {showForm && (
            <div className="border-b border-border bg-slate-50/60 px-4 py-3">
              <div className="grid gap-2.5 sm:grid-cols-3">
                <label className="text-[11.5px] text-slate-600">Jurisdiction
                  <select value={form.jurisdiction_id || ""} onChange={(e) => setForm({ ...form, jurisdiction_id: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                    <option value="">Select…</option>
                    {jurisdictions.map((j) => <option key={j.id} value={j.jurisdiction_id}>{j.name}</option>)}
                  </select>
                </label>
                <label className="text-[11.5px] text-slate-600">Publishing authority
                  <input value={form.authority || ""} onChange={(e) => setForm({ ...form, authority: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
                </label>
                <label className="text-[11.5px] text-slate-600">URL
                  <input value={form.url || ""} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
                </label>
                <label className="text-[11.5px] text-slate-600">Source type
                  <select value={form.source_type || "Regulator publication page"} onChange={(e) => setForm({ ...form, source_type: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                    {["Regulator publication page", "Technical standards", "Legislation database", "Official gazette", "Parliamentary bill or consultation", "Court judgment", "Enforcement publication", "Other official"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="text-[11.5px] text-slate-600">Language
                  <input value={form.language || ""} onChange={(e) => setForm({ ...form, language: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
                </label>
                <label className="text-[11.5px] text-slate-600">Topics (comma separated)
                  <input value={form.topics || ""} onChange={(e) => setForm({ ...form, topics: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
                </label>
                <label className="text-[11.5px] text-slate-600">Collection method
                  <select value={form.collection_method || "Direct page retrieval"} onChange={(e) => setForm({ ...form, collection_method: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                    {["Official feed or API", "Direct page retrieval", "Browser rendering", "Not configured"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="text-[11.5px] text-slate-600">Checking frequency
                  <select value={form.check_frequency || "Daily"} onChange={(e) => setForm({ ...form, check_frequency: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                    {["Six-hourly", "Daily", "Weekly", "Manual"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="text-[11.5px] text-slate-600">Verification evidence
                  <input value={form.verification_evidence || ""} onChange={(e) => setForm({ ...form, verification_evidence: e.target.value })} placeholder="Why this is the official publisher" className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
                </label>
              </div>
              <button type="button" onClick={addSource} disabled={busy} className="mt-2 rounded-sm bg-green-800 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">Save source</button>
            </div>
          )}
          <DataTable
            loading={loading}
            rowKey="id"
            rows={filtered}
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
              {
                key: "authority",
                header: "Source",
                render: (s) => (
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{s.authority}</div>
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="block max-w-[420px] truncate font-mono text-[11px] text-green-800 hover:underline">{s.url}</a>
                    <div className="text-[11px] text-muted-foreground">{s.jurisdiction_name} · {s.source_type} · {s.language}</div>
                  </div>
                ),
              },
              { key: "verification_status", header: "Verification", render: (s) => <StatusBadge tone={VERIFICATION_TONE[s.verification_status] || "unknown"}>{s.verification_status}</StatusBadge> },
              { key: "retrieval", header: "Retrieval test", render: (s) => (
                <div className="max-w-[220px] text-[10.5px] leading-snug text-slate-600">
                  <div>{s.retrieval_result || "Not tested by the collector"}</div>
                  {s.retrieval_page_title && <div className="text-slate-500">“{s.retrieval_page_title}”</div>}
                  {s.publisher_evidence && <div className="mt-0.5 text-slate-500">{s.publisher_evidence.slice(0, 160)}</div>}
                </div>
              ) },
              { key: "health_status", header: "Health", render: (s) => (
                <div className="space-y-1">
                  <StatusBadge tone={HEALTH_TONES[s.health_status] || "unknown"} dot={false}>{s.health_status}</StatusBadge>
                  {s.failure_reason && <div className="max-w-[240px] text-[10.5px] leading-snug text-red-700">{s.failure_reason}</div>}
                </div>
              ) },
              { key: "schedule", header: "Schedule", render: (s) => (
                <div className="text-[11px] leading-snug">
                  <select value={s.check_frequency} onChange={(e) => updateSource(s, { check_frequency: e.target.value })} className="h-7 rounded-sm border border-border bg-white px-1 text-[11.5px]">
                    {["Six-hourly", "Daily", "Weekly", "Manual"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <div className="mt-1 text-muted-foreground">Next: {s.next_check_at ? fmtDateTime(s.next_check_at) : "not scheduled"}</div>
                  <div className="text-muted-foreground">Last ok: {s.last_success_at ? fromNow(s.last_success_at) : "never"}</div>
                </div>
              ) },
              { key: "pipeline", header: "Pipeline", render: (s) => (
                <div className="space-y-0.5 text-[10.5px] text-slate-600">
                  <div>Fetch: {s.fetch_status || "—"}</div>
                  <div>Extract: {s.extraction_status || "—"}</div>
                  <div>Analyse: {s.analysis_status || "—"}</div>
                  <div>Notify: {s.notification_status || "—"}</div>
                  <TraversalSettings source={s} onSaved={load} />
                </div>
              ) },
              {
                key: "run",
                header: "",
                render: (s) => (
                  <button type="button" onClick={() => runNow([s.source_id])} disabled={busy || s.verification_status !== "Verified"} className="rounded-sm border border-border px-2 py-1 text-[11px] text-slate-700 disabled:opacity-30">
                    Run now
                  </button>
                ),
              },
            ]}
            empty={<EmptyState icon={Activity} title="No official sources yet" description="Propose sources from Discovery, then verify them in a batch. Collection cannot run on unverified sources." />}
          />
        </SectionCard>
      )}

      {tab === "jobs" && (
        <div className="space-y-5">
          <ManagedCapturePanel />
          <SectionCard title="Collection jobs" description="Small, resumable jobs. One failing source never stops the others.">
            <DataTable
              loading={loading}
              rows={jobs}
              columns={[
                { key: "run_id", header: "Run", render: (j) => <span className="font-mono text-[11px] text-slate-600">{j.run_id}</span> },
                { key: "source_name", header: "Source", render: (j) => <div><div className="text-slate-900">{j.source_name}</div><div className="text-[11px] text-muted-foreground">{j.jurisdiction_name}</div></div> },
                { key: "status", header: "Status", render: (j) => <StatusBadge tone={JOBS_TONE[j.status] || "unknown"}>{j.status}</StatusBadge> },
                { key: "timing", header: "Started / finished", render: (j) => <span className="num text-[11px]">{j.started_at ? fmtDateTime(j.started_at) : "—"}<br />{j.finished_at ? fmtDateTime(j.finished_at) : "running"}</span> },
                { key: "counts", header: "Docs (new/changed)", render: (j) => <span className="num text-[11.5px]">{j.documents_new || 0} / {j.documents_changed || 0}</span> },
                { key: "unchanged", header: "Unchanged", render: (j) => <span className="num text-[11.5px]">{j.documents_unchanged || 0}</span> },
                { key: "alerts", header: "Alerts", render: (j) => <span className="num text-[11.5px]">{j.alerts_created || 0}</span> },
                { key: "trigger", header: "Trigger", render: (j) => <span className="max-w-[150px] text-[11px] leading-snug text-slate-600">{j.trigger_type || "not recorded"}</span> },
                { key: "error_message", header: "Failure / gaps", render: (j) => <span className="max-w-[260px] text-[11px] leading-snug text-red-700">{j.error_message || j.attachment_gaps || "—"}</span> },
              ]}
              empty={<EmptyState icon={Activity} title="No collection run yet" description="The scheduled monitor records a job per source. Without a verified source nothing can be checked — that is not a clean result." />}
            />
          </SectionCard>
        </div>
      )}

      {tab === "coverage" && (
        <div className="space-y-5">
          <CollectionScopePanel sources={sources} jobs={jobs} config={config} />
          <SourceFormatGaps />
          <SectionCard title="Honest coverage accounting" description="Imported rows, resolved jurisdictions, operational sources and uncovered topics are different things.">
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Imported source rows", importedRows, "from the seed workbook"],
                ["Promoted master records", jurisdictions.length, "excludes the two held Cayman/Caymen rows"],
                ["Verified sources", verified.length, "eligible for scheduled checks"],
                ["Jurisdictions with no verified source", unresolved.length, "monitoring gap, not compliance"],
              ].map(([label, value, note]) => (
                <div key={label} className="bg-white px-4 py-3">
                  <div className="num text-[20px] font-semibold text-slate-900">{value}</div>
                  <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
                  <div className="text-[11px] text-muted-foreground">{note}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-3">
              <div className="eyebrow mb-2">Topic coverage across verified sources</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {COVERAGE_TOPICS.map((topic) => {
                  const count = new Set(verified.filter((s) => (s.topics || []).join(" ").toLowerCase().includes(topic.split(" ")[0].toLowerCase())).map((s) => s.jurisdiction_id)).size;
                  return (
                    <div key={topic} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2.5 py-1.5">
                      <span className="text-[12px] text-slate-700">{topic}</span>
                      <StatusBadge tone={count ? "success" : "unknown"}>{count ? `${count} jurisdiction(s)` : "No coverage"}</StatusBadge>
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Per-jurisdiction coverage" description="A regulator homepage retrieval is not coverage, and one unchanged selected publication does not establish that a jurisdiction is monitored. Unverified sources do not count at all.">
            <DataTable
              loading={loading}
              rows={jurisdictions}
              columns={[
                { key: "name", header: "Jurisdiction", render: (j) => <span className="font-medium text-slate-900">{j.name}</span> },
                { key: "sources", header: "Sources", render: (j) => {
                  const all = sources.filter((s) => s.jurisdiction_id === j.jurisdiction_id);
                  const ok = all.filter((s) => s.verification_status === "Verified");
                  return <span className="num text-[11.5px]">{ok.length} verified / {all.length} proposed</span>;
                } },
                { key: "topics", header: "Topics covered", render: (j) => {
                  const ok = sources.filter((s) => s.jurisdiction_id === j.jurisdiction_id && s.verification_status === "Verified");
                  const topics = new Set(ok.flatMap((s) => (s.topics || []).map((t) => t.toLowerCase().split(" ")[0])));
                  return <span className="num text-[11.5px]">{topics.size || 0}</span>;
                } },
                { key: "last", header: "Last page retrieval", render: (j) => {
                  const ok = sources.filter((s) => s.jurisdiction_id === j.jurisdiction_id && s.last_success_at).map((s) => s.last_success_at).sort().pop();
                  return <span className="num text-[11px]">{ok ? fmtDateTime(ok) : "Never"}</span>;
                } },
                { key: "status", header: "Monitoring", render: (j) => <StatusBadge tone={j.monitoring_status === "Monitored" ? "success" : j.monitoring_status === "No sources configured" ? "unknown" : "warning"} dot={false}>{j.monitoring_status || "No sources configured"}</StatusBadge> },
              ]}
              empty={<EmptyState icon={Activity} title="No jurisdictions" description="Import the register to see coverage per jurisdiction." />}
            />
          </SectionCard>
        </div>
      )}
    </>
  );
}