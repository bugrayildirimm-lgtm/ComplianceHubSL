import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import OwnershipEditor from "@/components/jurisdiction/OwnershipEditor";
import OperatingPosition from "@/components/jurisdiction/OperatingPosition";
import {
  CLASSIFICATION_TONE, OWNERSHIP_TONE, PRIORITY_TONE, STAGE_TONE, APPROVAL_TONE,
  VERIFICATION_TONE, HEALTH_TONES, fmtDate, fmtDateTime, COVERAGE_TOPICS,
} from "@/lib/format";
import { AlertTriangle, ArrowLeft, Radar, ShieldCheck, ListChecks, BookOpen, Activity } from "lucide-react";

export default function JurisdictionDetail() {
  const { jurisdictionId } = useParams();
  const [jurisdiction, setJurisdiction] = useState(null);
  const [related, setRelated] = useState({ sources: [], alerts: [], requirements: [], licences: [], actions: [], profiles: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const found = await base44.entities.Jurisdiction.filter({ jurisdiction_id: jurisdictionId });
    const record = found[0] || null;
    setJurisdiction(record);
    if (record) {
      const [sources, alerts, requirements, licences, actions, profiles, documentsPage, configPage] = await Promise.all([
        base44.entities.Source.filter({ jurisdiction_id: jurisdictionId }),
        base44.entities.RegulatoryAlert.filter({ jurisdiction_id: jurisdictionId }, { sort: "-detection_date", limit: 40 }),
        base44.entities.Requirement.filter({ jurisdiction_id: jurisdictionId }),
        base44.entities.LicenceCertificate.filter({ jurisdiction_id: jurisdictionId }),
        base44.entities.ActionItem.filter({ jurisdiction_id: jurisdictionId }),
        base44.entities.MarketProfile.filter({ jurisdiction_id: jurisdictionId }),
        base44.entities.DocumentRecord.filter({ jurisdiction_name: record.name }, { sort: "-fetched_at", limit: 100 }),
        base44.entities.MonitoringConfig.filter({ config_key: "default" }),
      ]);
      const configList = Array.isArray(configPage) ? configPage : configPage.items || [];
      setRelated({
        sources,
        alerts: alerts.items || alerts,
        requirements,
        licences,
        actions,
        profiles,
        documents: documentsPage.items || [],
        config: configList[0] || null,
      });
    }
    setLoading(false);
  }, [jurisdictionId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="h-40 animate-pulse rounded-md bg-slate-100" />;
  if (!jurisdiction) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Jurisdiction not found"
        description="This master ID does not exist in the register."
        action={<Link to="/jurisdictions" className="text-[12.5px] font-medium text-green-800">Back to jurisdictions</Link>}
      />
    );
  }

  const verifiedSources = related.sources.filter((s) => s.verification_status === "Verified");
  const coveredTopics = COVERAGE_TOPICS.filter((topic) =>
    verifiedSources.some((s) => (s.topics || []).join(" ").toLowerCase().includes(topic.split(" ")[0].toLowerCase()))
  );
  const gaps = COVERAGE_TOPICS.filter((t) => !coveredTopics.includes(t));

  return (
    <>
      <div className="mb-5">
        <Link to="/jurisdictions" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" /> All jurisdictions
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11.5px] text-slate-500">{jurisdiction.jurisdiction_id}</span>
              <StatusBadge tone={CLASSIFICATION_TONE[jurisdiction.internal_classification] || "unknown"}>
                {jurisdiction.internal_classification}
              </StatusBadge>
              <StatusBadge tone={OWNERSHIP_TONE[jurisdiction.ownership_status] || "unknown"}>
                {jurisdiction.ownership_status}
              </StatusBadge>
            </div>
            <h1 className="mt-1.5 text-[24px] font-semibold leading-tight text-slate-900">{jurisdiction.name}</h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {jurisdiction.territory_scope}
              {jurisdiction.parent_jurisdiction ? ` · under ${jurisdiction.parent_jurisdiction}` : ""} · imported as
              {" "}"{jurisdiction.name_raw}" · {jurisdiction.import_row_key}
            </p>
          </div>
          <div className="text-right text-[11.5px] text-muted-foreground">
            <div>Legal verification: <span className="text-slate-800">{jurisdiction.legal_verification_status}</span></div>
            <div>Product scope: <span className="text-slate-800">{jurisdiction.product_scope_status}</span></div>
            <div>Classification basis: internal register, not legal advice</div>
          </div>
        </div>
      </div>

      {(jurisdiction.review_flags || []).length > 0 && (
        <div className="mb-5 rounded-md border border-amber-200 bg-amber-50/70 px-3.5 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" /> Review flags carried from the source register
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-amber-900">
            {jurisdiction.review_flags.map((flag) => <li key={flag}>{flag}</li>)}
          </ul>
        </div>
      )}

      <div className="mb-5">
        <OperatingPosition
          jurisdiction={jurisdiction}
          sources={related.sources}
          alerts={related.alerts}
          requirements={related.requirements}
          documents={related.documents}
          config={related.config}
          coveredTopics={coveredTopics.length}
          totalTopics={COVERAGE_TOPICS.length}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SectionCard
            title="Monitoring sources"
            description={`${related.sources.length} source(s) · ${verifiedSources.length} verified`}
            actions={<Link to="/discovery" className="text-[12px] font-medium text-green-800 hover:underline">Discover sources</Link>}
          >
            {related.sources.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No official source configured"
                description="A regulator homepage alone is not coverage. Propose and verify sources before collection can run for this jurisdiction."
              />
            ) : (
              <ul className="divide-y divide-border">
                {related.sources.map((source) => (
                  <li key={source.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-slate-900">{source.authority}</div>
                      <div className="truncate text-[11.5px] text-muted-foreground">{source.url}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {source.source_type} · {source.language} · {source.check_frequency} · next {fmtDateTime(source.next_check_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge tone={VERIFICATION_TONE[source.verification_status] || "unknown"}>{source.verification_status}</StatusBadge>
                      <StatusBadge tone={HEALTH_TONES[source.health_status] || "unknown"} dot={false}>{source.health_status}</StatusBadge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Latest developments"
            description="Draft alerts are AI-prepared and unreviewed until a person records an assessment."
            actions={<Link to="/radar" className="text-[12px] font-medium text-green-800 hover:underline">Radar</Link>}
          >
            {related.alerts.length === 0 ? (
              <EmptyState
                icon={Radar}
                title="No relevant changes detected in successfully checked sources"
                description={verifiedSources.length
                  ? "Scope: verified sources for this jurisdiction. No collection run has recorded a change yet."
                  : "This jurisdiction has no verified source, so no change could be detected. That is not evidence that nothing changed."}
              />
            ) : (
              <ul className="divide-y divide-border">
                {related.alerts.slice(0, 6).map((alert) => (
                  <li key={alert.id} className="rowlink px-4 py-2.5">
                    <Link to={`/radar/${alert.id}`} className="block">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={STAGE_TONE[alert.legal_stage] || "unknown"} dot={false}>{alert.legal_stage}</StatusBadge>
                        <StatusBadge tone={PRIORITY_TONE[alert.priority] || "unknown"} dot={false}>{alert.priority}</StatusBadge>
                        {alert.previously_untracked && <StatusBadge tone="info" dot={false}>Previously untracked</StatusBadge>}
                      </div>
                      <div className="mt-1 text-[12.5px] font-medium text-slate-900">{alert.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Detected {fmtDate(alert.detection_date)} · {alert.review_status}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Requirements"
            description={`${related.requirements.length} record(s) for this jurisdiction`}
            actions={<Link to="/requirements" className="text-[12px] font-medium text-green-800 hover:underline">Library</Link>}
          >
            {related.requirements.length === 0 ? (
              <EmptyState icon={BookOpen} title="No requirements recorded" description="The requirements baseline is researched separately from monitoring. Nothing is assumed for this jurisdiction." />
            ) : (
              <ul className="divide-y divide-border">
                {related.requirements.map((req) => (
                  <li key={req.id} className="rowlink px-4 py-2.5">
                    <Link to={`/requirements/${req.id}`} className="block">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{req.requirement_id}</span>
                        <StatusBadge tone={APPROVAL_TONE[req.approval_status] || "unknown"} dot={false}>{req.approval_status}</StatusBadge>
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-slate-900">{req.title}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <div className="grid gap-5 sm:grid-cols-2">
            <SectionCard title="Licences & certificates">
              {related.licences.length === 0 ? (
                <EmptyState icon={ShieldCheck} title="None recorded" description="Licences and certificates are never inferred from the internal classification." />
              ) : (
                <ul className="divide-y divide-border">
                  {related.licences.map((licence) => (
                    <li key={licence.id} className="px-4 py-2.5 text-[12.5px]">
                      <div className="font-medium text-slate-900">{licence.record_type}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {licence.legal_entity_name || "Entity unknown"} · ref {licence.reference_number || "Unknown"} · {licence.status}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Market profiles">
              {related.profiles.length === 0 ? (
                <EmptyState icon={ListChecks} title="Not established" description="No product/entity market profile exists for this jurisdiction yet." />
              ) : (
                <ul className="divide-y divide-border">
                  {related.profiles.map((profile) => (
                    <li key={profile.id} className="px-4 py-2.5 text-[12.5px]">
                      <div className="font-medium text-slate-900">{profile.product_type}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {profile.legal_entity_name || "Entity unknown"} · {profile.permission_status}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>

        <div className="space-y-5">
          <SectionCard title="Accountability" description="One accountable primary owner plus collaborating teams. Unresolved ownership never blocks monitoring.">
            <OwnershipEditor jurisdiction={jurisdiction} onSaved={load} />
          </SectionCard>

          <SectionCard title="Coverage gaps" description="Tracked by topic — a homepage is not coverage.">
            <ul className="divide-y divide-border">
              {COVERAGE_TOPICS.map((topic) => {
                const covered = coveredTopics.includes(topic);
                return (
                  <li key={topic} className="flex items-center justify-between gap-2 px-4 py-2 text-[12px]">
                    <span className={covered ? "text-slate-800" : "text-slate-500"}>{topic}</span>
                    <StatusBadge tone={covered ? "success" : "unknown"} dot={!covered}>
                      {covered ? "Covered" : "Gap"}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border bg-slate-50/60 px-4 py-2 text-[11.5px] text-slate-600">
              {gaps.length} of {COVERAGE_TOPICS.length} topic areas have no verified source.
            </div>
          </SectionCard>

          <SectionCard title="Open actions">
            {related.actions.length === 0 ? (
              <EmptyState icon={ListChecks} title="No actions" description="Actions are created from a reviewed impact assessment." />
            ) : (
              <ul className="divide-y divide-border">
                {related.actions.map((action) => (
                  <li key={action.id} className="px-4 py-2.5 text-[12.5px]">
                    <div className="font-medium text-slate-900">{action.title}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {action.status} · due {fmtDate(action.due_date)} · {action.owner_team || "unassigned"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Record provenance">
            <dl className="divide-y divide-border text-[12px]">
              {[
                ["Source file", jurisdiction.source_file || "Unknown"],
                ["Source period", jurisdiction.source_period || "Unknown"],
                ["Source row", jurisdiction.source_row || "Unknown"],
                ["Import row key", jurisdiction.import_row_key || "Unknown"],
                ["Duplicate group", jurisdiction.duplicate_group || "None"],
                ["Created", fmtDateTime(jurisdiction.created_date)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3 px-4 py-1.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        </div>
      </div>
    </>
  );
}