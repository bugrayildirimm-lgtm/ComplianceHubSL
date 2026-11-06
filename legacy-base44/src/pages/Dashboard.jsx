import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { COVERAGE_TOPICS, PRIORITY_TONE, fmtDateTime, isOverdue, daysUntil } from "@/lib/format";
import {
  AlertTriangle, ArrowRight, CalendarClock, Globe2, Radar, ShieldCheck,
  ListChecks, Activity, BookOpen, Info,
} from "lucide-react";

export default function Dashboard() {
  const [data, setData] = useState({ jurisdictions: [], sources: [], alerts: [], requirements: [], actions: [], approvals: [], batches: [], jobs: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [jurisdictions, sources, alerts, requirements, actions, approvals, batches, jobs] = await Promise.all([
        base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 }),
        base44.entities.Source.list({ limit: 500 }),
        base44.entities.RegulatoryAlert.list({ sort: "-created_date", limit: 300 }),
        base44.entities.Requirement.filter({ is_fixture: { $ne: true } }, { limit: 500 }),
        base44.entities.ActionItem.list({ limit: 400 }),
        base44.entities.Approval.list({ limit: 200 }),
        base44.entities.ImportBatch.list({ sort: "-created_date", limit: 10 }),
        base44.entities.CollectionJob.list({ sort: "-created_date", limit: 60 }),
      ]);
      setData({
        jurisdictions: jurisdictions.items || [],
        sources: sources.items || [],
        alerts: alerts.items || [],
        requirements: requirements.items || [],
        actions: actions.items || [],
        approvals: approvals.items || [],
        batches: batches.items || [],
        jobs: jobs.items || [],
      });
      setLoading(false);
    })();
  }, []);

  const derived = useMemo(() => {
    const verified = data.sources.filter((s) => s.verification_status === "Verified");
    const awaiting = data.sources.filter((s) => s.verification_status === "Awaiting source verification");
    const failed = data.sources.filter((s) => s.health_status === "Failed or blocked");
    const overdueActions = data.actions.filter((a) => isOverdue(a.due_date) && a.status !== "Closed");
    const dueSoon = data.actions.filter((a) => {
      const d = daysUntil(a.due_date);
      return d !== null && d >= 0 && d <= 7 && a.status !== "Closed";
    });
    const unassessed = data.alerts.filter((a) => a.assessment_outcome === "Not assessed" && a.withdrawn !== true);
    const pendingApprovals = data.approvals.filter((a) => a.decision === "Pending");
    const candidates = data.requirements.filter((r) => r.approval_status === "Candidate — unreviewed");
    const ownershipQueue = data.jurisdictions.filter((j) => j.ownership_status !== "Assigned");
    const uncovered = data.jurisdictions.filter((j) => !verified.some((s) => s.jurisdiction_id === j.jurisdiction_id));
    const approvedRequirements = data.requirements.filter((r) => r.approval_status === "Approved");
    const lastCheck = data.sources.map((s) => s.last_success_at).filter(Boolean).sort().pop();
    const lastJob = data.jobs[0];
    const topicCoverage = COVERAGE_TOPICS.map((topic) => ({
      topic,
      covered: new Set(verified.filter((s) => (s.topics || []).join(" ").toLowerCase().includes(topic.split(" ")[0].toLowerCase())).map((s) => s.jurisdiction_id)).size,
    }));
    return { verified, awaiting, failed, overdueActions, dueSoon, unassessed, pendingApprovals, candidates, ownershipQueue, uncovered, approvedRequirements, lastCheck, lastJob, topicCoverage };
  }, [data]);

  const attention = useMemo(() => {
    const items = [];
    if (derived.overdueActions.length) {
      items.push({ tone: "danger", label: "Overdue", title: `${derived.overdueActions.length} action(s) overdue`, scope: "Actions & deadlines", to: "/actions" });
    }
    if (derived.failed.length) {
      items.push({ tone: "danger", label: "Blocked", title: `${derived.failed.length} source(s) failed or blocked`, scope: "Sources & coverage", to: "/sources" });
    }
    if (derived.awaiting.length) {
      items.push({ tone: "warning", label: "Review", title: `${derived.awaiting.length} candidate source(s) awaiting verification`, scope: "Discovery & review", to: "/discovery" });
    }
    if (derived.unassessed.length) {
      items.push({ tone: "warning", label: "Assess", title: `${derived.unassessed.length} alert(s) without an impact assessment`, scope: "Regulatory radar", to: "/radar" });
    }
    if (derived.pendingApprovals.length) {
      items.push({ tone: "info", label: "Approval", title: `${derived.pendingApprovals.length} approval(s) awaiting a designated reviewer`, scope: "Approvals", to: "/approvals" });
    }
    if (derived.candidates.length) {
      items.push({ tone: "info", label: "Unreviewed", title: `${derived.candidates.length} requirement candidate(s) not approved`, scope: "Requirements library", to: "/requirements" });
    }
    if (derived.ownershipQueue.length) {
      items.push({ tone: "neutral", label: "Ownership", title: `${derived.ownershipQueue.length} jurisdiction(s) awaiting explicit ownership`, scope: "Jurisdictions", to: "/jurisdictions" });
    }
    if (derived.uncovered.length) {
      items.push({ tone: "neutral", label: "Coverage", title: `${derived.uncovered.length} jurisdiction(s) without a verified source`, scope: "Monitoring coverage", to: "/sources" });
    }
    if (derived.dueSoon.length) {
      items.push({ tone: "warning", label: "Deadline", title: `${derived.dueSoon.length} action(s) due within 7 days`, scope: "Actions & deadlines", to: "/actions" });
    }
    return items;
  }, [derived]);

  const isEmpty = !loading && data.jurisdictions.length === 0 && data.sources.length === 0 && data.alerts.length === 0;

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Malta" }).format(new Date()) + " · Europe/Malta"}
        title="Dashboard"
        description="What needs attention across the jurisdiction register, official-source monitoring and the requirements library. Deliberately not a compliance score."
        actions={
          <Link to="/discovery" className="inline-flex items-center gap-2 rounded-sm bg-slate-900 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-slate-800">
            Review queue <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Register records" value={data.jurisdictions.length} sub={`${derived.ownershipQueue.length} awaiting ownership`} icon={Globe2} to="/jurisdictions" />
        <Stat label="Verified sources" value={derived.verified.length} sub={`${derived.awaiting.length} awaiting verification · ${derived.failed.length} blocked`} icon={Activity} to="/sources" />
        <Stat label="Draft alerts" value={derived.unassessed.length} sub={`${data.alerts.length} alert(s) in total · ${derived.pendingApprovals.length} approval(s) pending`} icon={Radar} to="/radar" />
        <Stat label="Overdue actions" value={derived.overdueActions.length} sub={`${derived.dueSoon.length} due within 7 days`} icon={CalendarClock} to="/actions" />
      </div>

      {isEmpty && (
        <div className="mt-5 rounded-md border border-border bg-white p-5">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div>
              <h2 className="text-[14px] font-semibold text-slate-900">Start with the jurisdiction register</h2>
              <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                Nothing is pre-loaded. Load the Import_Staging sheet, review the flagged rows, promote them, then let discovery propose official sources.
                Monitoring and the requirements baseline stay empty (and visibly so) until real evidence exists.
              </p>
              <Link to="/discovery" className="mt-3 inline-flex items-center gap-2 rounded-sm bg-green-800 px-3 py-2 text-[12.5px] font-medium text-white">
                Open import review <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <SectionCard
          title="Needs attention"
          className="xl:col-span-3"
          description="Ordered by consequence: blocked collection first, then unresolved decisions."
        >
          {loading ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded-sm bg-slate-100" />)}</div>
          ) : attention.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No open attention items"
              description="Nothing is overdue, unverified or awaiting review. This reflects the records held here only — it is not a statement of regulatory compliance."
            />
          ) : (
            <ul className="divide-y divide-border">
              {attention.map((item) => (
                <li key={item.title} className="rowlink">
                  <Link to={item.to} className="flex items-start gap-3 px-4 py-2.5">
                    <StatusBadge tone={item.tone} dot={false} className="mt-0.5">{item.label}</StatusBadge>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-snug text-slate-900">{item.title}</div>
                      <div className="text-[11.5px] text-muted-foreground">{item.scope}</div>
                    </div>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="flex flex-col gap-6 xl:col-span-2">
          <SectionCard title="Collection health" actions={<Link to="/sources" className="text-[12px] font-medium text-green-800 hover:underline">Sources</Link>}>
            <div className="divide-y divide-border">
              {[
                ["Verified for collection", derived.verified.length, "eligible for scheduled checks"],
                ["Awaiting verification", derived.awaiting.length, "no collection until verified"],
                ["Failed or blocked", derived.failed.length, "fetch, extraction or access block"],
                ["Last successful check", derived.lastCheck ? fmtDateTime(derived.lastCheck) : "Never", "Europe/Malta"],
                ["Last job", derived.lastJob ? `${derived.lastJob.status}` : "No run recorded", derived.lastJob ? fmtDateTime(derived.lastJob.finished_at || derived.lastJob.started_at) : "scheduler will record each attempt"],
              ].map(([label, value, note]) => (
                <div key={label} className="flex items-start justify-between gap-3 px-4 py-2">
                  <div>
                    <div className="text-[12.5px] text-slate-800">{label}</div>
                    <div className="text-[11px] text-muted-foreground">{note}</div>
                  </div>
                  <span className={`num shrink-0 text-right text-[12.5px] font-medium text-slate-900 ${typeof value === "string" && value.length > 12 ? "max-w-[130px] text-[11px]" : ""}`}>{value}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border bg-slate-50/60 px-4 py-2.5 text-[11px] leading-relaxed text-slate-600">
              An empty alert list only ever means: no relevant change detected in the sources actually checked.
            </div>
          </SectionCard>

          <SectionCard title="Register composition" description={`${data.batches.reduce((sum, b) => sum + (b.row_count || 0), 0) || 0} source row(s) imported across ${data.batches.length} batch(es)`}>
            <div className="grid grid-cols-2 gap-px bg-border">
              {[
                ["Licensed Jurisdiction", "success"],
                ["Conditionally Permitted", "info"],
                ["Prohibited Territory", "danger"],
                ["Not on RTL / Under Consideration", "warning"],
              ].map(([label, tone]) => (
                <div key={label} className="bg-white px-4 py-2.5">
                  <div className="num text-[18px] font-semibold text-slate-900">
                    {data.jurisdictions.filter((j) => j.internal_classification === label).length}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            <p className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-slate-600">
              Internal classification is not a legal determination: a prohibited territory is not proof of a legal ban, and "not on RTL" is not permission.
            </p>
          </SectionCard>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Topic coverage" description="Derived from verified sources only" actions={<span className="text-[11.5px] text-slate-500">{derived.topicCoverage.filter((t) => t.covered > 0).length} of {COVERAGE_TOPICS.length} areas covered</span>}>
          <div className="space-y-2.5 px-4 py-3">
            {derived.topicCoverage.map((c) => (
              <div key={c.topic}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-700">{c.topic}</span>
                  <span className="num text-muted-foreground">{c.covered} jurisdiction(s)</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-green-700" style={{ width: `${Math.min(100, (c.covered / Math.max(1, data.jurisdictions.length)) * 100)}%` }} />
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-relaxed text-slate-600">
              A regulator homepage is not coverage. Gaps are tracked per topic, per jurisdiction and per product line.
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Requirements baseline" description="Tracked separately from newly published changes">
          <div className="grid grid-cols-2 gap-px bg-border">
            {[
              ["Approved", derived.approvedRequirements.length, BookOpen],
              ["Unreviewed candidates", derived.candidates.length, ListChecks],
              ["Applicability unknown", data.requirements.filter((r) => r.applicability_status === "Unknown").length, AlertTriangle],
              ["Implementation unknown", derived.approvedRequirements.filter((r) => r.implementation_status === "Unknown").length, ShieldCheck],
            ].map(([label, value, Icon]) => (
              <div key={label} className="bg-white px-4 py-3">
                <div className="flex items-start justify-between">
                  <div className="num text-[18px] font-semibold text-slate-900">{value}</div>
                  <Icon className="h-3.5 w-3.5 text-slate-300" />
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 py-2.5">
            <Link to="/requirements" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-green-800 hover:underline">
              Open the library <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function Stat({ label, value, sub, icon: Icon, to }) {
  return (
    <Link to={to} className="panel group p-4 transition-colors hover:border-slate-300">
      <div className="flex items-start justify-between">
        <div className="eyebrow">{label}</div>
        <Icon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500" />
      </div>
      <div className="num mt-2 text-[26px] font-semibold leading-none text-slate-900">{value}</div>
      <div className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{sub}</div>
    </Link>
  );
}