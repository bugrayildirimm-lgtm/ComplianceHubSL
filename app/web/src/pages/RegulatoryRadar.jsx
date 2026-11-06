import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/PageHeader";
import FilterBar from "@/components/FilterBar";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { LEGAL_STAGES, PRIORITY_TONE, REVIEW_TONE, STAGE_TONE, fmtDate, fmtDateTime } from "@/lib/format";
import { Radar } from "lucide-react";

export default function RegulatoryRadar() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [priority, setPriority] = useState("");
  const [review, setReview] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");

  useEffect(() => {
    (async () => {
      const [alertPage, allSources] = await Promise.all([
        base44.entities.RegulatoryAlert.list({ sort: "-created_date", limit: 400 }),
        base44.entities.Source.list({ limit: 500 }),
      ]);
      setAlerts(alertPage.items || []);
      setSources(allSources.items || []);
      setLoading(false);
    })();
  }, []);

  const jurisdictions = useMemo(
    () => Array.from(new Set(alerts.map((a) => a.jurisdiction_name).filter(Boolean))).sort(),
    [alerts]
  );

  // Withdrawn alerts stay stored with their evidence and audit history, but are never counted
  // or listed as current developments.
  const activeAlerts = useMemo(() => alerts.filter((a) => a.withdrawn !== true), [alerts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return activeAlerts.filter((alert) => {
      if (stage && alert.legal_stage !== stage) return false;
      if (priority && alert.priority !== priority) return false;
      if (review && alert.review_status !== review) return false;
      if (jurisdiction && alert.jurisdiction_name !== jurisdiction) return false;
      if (!term) return true;
      return [alert.title, alert.summary, alert.authority, alert.jurisdiction_name, alert.alert_ref]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [activeAlerts, search, stage, priority, review, jurisdiction]);

  const verifiedSources = sources.filter((s) => s.verification_status === "Verified");
  const lastCheck = sources
    .map((s) => s.last_success_at)
    .filter(Boolean)
    .sort()
    .pop();

  const columns = [
    {
      key: "title",
      header: "Development",
      render: (alert) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-slate-400">{alert.alert_ref}</span>
            {alert.ai_generated && <StatusBadge tone="neutral" dot={false}>AI draft — unreviewed</StatusBadge>}
            {alert.is_fixture && <StatusBadge tone="warning" dot={false}>Test fixture</StatusBadge>}
            {alert.previously_untracked && <StatusBadge tone="info" dot={false}>Previously untracked</StatusBadge>}
          </div>
          <div className="mt-0.5 font-medium text-slate-900">{alert.title}</div>
          <div className="text-[11px] text-muted-foreground">{alert.authority}</div>
        </div>
      ),
    },
    { key: "jurisdiction_name", header: "Jurisdiction", render: (a) => <span className="text-slate-800">{a.jurisdiction_name || "Unknown"}</span> },
    { key: "legal_stage", header: "Legal stage", render: (a) => <StatusBadge tone={STAGE_TONE[a.legal_stage] || "unknown"} dot={false}>{a.legal_stage}</StatusBadge> },
    { key: "priority", header: "Priority", render: (a) => <StatusBadge tone={PRIORITY_TONE[a.priority] || "unknown"}>{a.priority}</StatusBadge> },
    {
      key: "dates",
      header: "Dates",
      render: (a) => (
        <div className="space-y-0.5 text-[11px]">
          <div>Published: {a.publication_date ? fmtDate(a.publication_date) : <span className="text-slate-400">not stated</span>}</div>
          <div>Detected: {a.detection_date ? fmtDate(a.detection_date) : "—"}</div>
          {a.effective_date && <div>Effective: {fmtDate(a.effective_date)}</div>}
          {a.implementation_deadline && <div className="text-amber-700">Deadline: {fmtDate(a.implementation_deadline)}</div>}
        </div>
      ),
    },
    { key: "review_status", header: "Review", render: (a) => (
      <div className="space-y-1">
        <StatusBadge tone={REVIEW_TONE[a.review_status] || "unknown"}>{a.review_status}</StatusBadge>
        <div className="text-[11px] text-muted-foreground">{a.assessment_outcome}</div>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Monitoring output"
        title="Regulatory Radar"
        description="Evidence-backed draft alerts from official publications. An empty list means only that no relevant change was detected in the sources actually checked — never that the position is compliant."
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        {[
          ["Draft alerts", activeAlerts.filter((a) => a.review_status === "Draft — unreviewed").length, "awaiting impact assessment"],
          ["Awaiting assessment", activeAlerts.filter((a) => a.assessment_outcome === "Not assessed").length, "no reviewer decision yet"],
          ["Verified sources", verifiedSources.length, `of ${sources.length} registered`],
          ["Last successful check", lastCheck ? fmtDateTime(lastCheck) : "None recorded", "Europe/Malta"],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-4 py-3">
            <div className="num text-[19px] font-semibold leading-tight text-slate-900">{value}</div>
            <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
            <div className="text-[11px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </div>

      <SectionCard title={`${filtered.length} development${filtered.length === 1 ? "" : "s"}`}>
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search title, authority, reference…"
          filters={[
            { key: "stage", label: "Stage", value: stage, onChange: setStage, options: LEGAL_STAGES },
            { key: "priority", label: "Priority", value: priority, onChange: setPriority, options: Object.keys(PRIORITY_TONE) },
            { key: "review", label: "Review", value: review, onChange: setReview, options: Object.keys(REVIEW_TONE) },
            { key: "jurisdiction", label: "Jurisdiction", value: jurisdiction, onChange: setJurisdiction, options: jurisdictions },
          ]}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          onRowClick={(row) => navigate(`/radar/${row.id}`)}
          empty={
            <EmptyState
              icon={Radar}
              title="No relevant changes detected in successfully checked sources"
              description={
                verifiedSources.length
                  ? `Scope: ${verifiedSources.length} verified source(s). Period: all collection runs recorded so far. Nothing here asserts that no regulatory change occurred elsewhere.`
                  : "No source has been verified yet, so nothing could be checked. Verify sources in Sources & Coverage to begin collection."
              }
            />
          }
        />
      </SectionCard>
    </>
  );
}