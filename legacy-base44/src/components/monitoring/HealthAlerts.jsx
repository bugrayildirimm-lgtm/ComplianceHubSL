import { useMemo } from "react";
import { AlertTriangle, Clock, Gauge, Layers, PowerOff } from "lucide-react";
import { fromNow } from "@/lib/format";

// Visible operational limitations. Every item here is a coverage limitation,
// never a successful check.
export default function HealthAlerts({ config, sources = [], queue = [], jobs = [], runs = [], pendingPublications = 0 }) {
  const alerts = useMemo(() => {
    const out = [];
    const now = Date.now();
    const live = sources.filter((s) => !s.is_fixture);
    const verified = live.filter((s) => s.verification_status === "Verified");
    const staleHours = 30;
    const lastRun = config?.last_run_at ? Date.parse(config.last_run_at) : 0;
    const hoursSinceRun = lastRun ? (now - lastRun) / 3600000 : null;

    // Direct publisher fetching stays disabled; the managed-browser path is the live collector.
    out.push({
      tone: "amber",
      icon: PowerOff,
      title: "Direct publisher fetch is disabled — collection runs through the managed browser",
      detail: "The legacy direct-fetch collector remains stopped for security reasons and is not used. Verified sources are collected by the platform cloud browser, which retrieves the listing page and only the publication links it actually observes. A listing capture is not jurisdiction coverage, and an unchanged selected publication is not proof that nothing changed elsewhere in the source.",
    });

    const cycleStatus = config?.cycle_status ? String(config.cycle_status) : "";
    if (cycleStatus === "Incomplete — capacity limited") {
      out.push({ tone: "red", icon: Gauge, title: "Last collection cycle closed with outstanding work", detail: config?.cycle_shortfall || "Part of the due scope was not processed. Affected sources are reported as overdue, not as checked." });
    } else if (cycleStatus === "Blocked — usage limit") {
      out.push({ tone: "red", icon: Gauge, title: "Collection cycle stopped by the app-side usage allowance", detail: config?.cycle_shortfall || "Remaining work is preserved. That allowance is an app-side reservation of AI calls, not measured platform billing." });
    } else if (cycleStatus === "Open") {
      out.push({ tone: "amber", icon: Clock, title: `Collection cycle ${config?.cycle_id || ""} still in progress`, detail: `${config?.cycle_pending_publications || 0} queued item(s) remain. They resume automatically on the next bounded tick and are not yet checked.` });
    } else if (!cycleStatus || cycleStatus === "Not started") {
      out.push({ tone: "amber", icon: Clock, title: "No collection cycle recorded yet", detail: "No cycle has opened, so no scope has been retrieved. Absence of alerts carries no meaning until a cycle runs and its scope is reported." });
    }

    if (Number(pendingPublications) > 0) {
      out.push({ tone: "amber", icon: Layers, title: `${pendingPublications} publication(s) queued and not yet captured`, detail: "These links were observed on a listing page but not yet retrieved or assessed. Their content is unknown — not unchanged." });
    }

    if (!config) {
      out.push({ tone: "red", icon: Gauge, title: "Monitoring configuration missing", detail: "No monitoring configuration record exists, so limits and a scheduler heartbeat cannot be read." });
    } else {
      if (hoursSinceRun === null) {
        out.push({ tone: "red", icon: Clock, title: "No collection timestamp recorded in configuration", detail: "This configuration has no collection timestamp. A manual collection timestamp would not establish a scheduled run; use platform workflow history for scheduler evidence." });
      } else if (hoursSinceRun > staleHours) {
        out.push({ tone: "red", icon: Clock, title: `Last recorded collection ${fromNow(config.last_run_at)}`, detail: `The configuration's collection timestamp is over ${staleHours}h old. This timestamp does not authenticate its trigger or prove scheduler activity. Stale checks are a coverage gap, not a clean result.` });
      }
      if (config.monitoring_enabled === false) {
        out.push({ tone: "red", icon: PowerOff, title: "Monitoring is disabled in configuration", detail: "Scheduled collection skips by design while this flag is off. Alerts are not being detected." });
      }
      if (config.budget_paused === true) {
        out.push({ tone: "amber", icon: Gauge, title: "Usage budget pause is active", detail: `${config.budget_paused_reason || "Batch work is paused by the configured usage budget."} Queued discovery and research work is preserved, but coverage is incomplete while the pause lasts.` });
      }
      const used = Number(config.credits_used_estimate || 0);
      const budget = Number(config.monthly_credit_budget || 0);
      if (budget > 0 && used / budget >= (Number(config.usage_alert_threshold_pct) || 80) / 100) {
        out.push({ tone: "amber", icon: Gauge, title: `Estimated AI usage at ${Math.round((used / budget) * 100)}% of the batch budget`, detail: `${used} estimated calls against a configured allowance of ${budget}. This is an app-side estimate from recorded calls, not a billing figure.` });
      }
    }

    const backlog = queue.filter((q) => ["Queued", "Researching", "Candidates proposed", "Coverage partial"].includes(q.status));
    if (backlog.length) {
      out.push({ tone: "amber", icon: Layers, title: `${backlog.length} jurisdiction(s) still in the discovery queue`, detail: "Source discovery has not finished across the register. Those jurisdictions have no verified source unless listed elsewhere, so their status is unknown rather than compliant." });
    }

    const awaiting = live.filter((s) => s.verification_status === "Awaiting source verification");
    if (awaiting.length) {
      out.push({ tone: "amber", icon: AlertTriangle, title: `${awaiting.length} candidate source(s) awaiting verification`, detail: "Candidates were retrieved and tested by the collector but are not monitoring sources until a person confirms the publishing authority." });
    }

    const failedSources = live.filter((s) => s.health_status === "Failed or blocked");
    if (failedSources.length) {
      out.push({ tone: "red", icon: AlertTriangle, title: `${failedSources.length} source(s) failing or blocked`, detail: "Collection, extraction and analysis failures are reported per source. Each failure is a source-specific coverage gap, not evidence that the jurisdiction has no published requirements." });
    }

    const failedJobs = jobs.filter((j) => j.status === "Failed or blocked" || j.status === "Partially processed");
    if (failedJobs.length) {
      out.push({ tone: "amber", icon: AlertTriangle, title: `${failedJobs.length} collection job(s) failed or partially processed`, detail: "Partial processing means a document could not be extracted. It must not be read as a fully successful check." });
    }

    const blockedRuns = runs.filter((r) => r.status === "Blocked — budget or usage limit");
    if (blockedRuns.length) {
      out.push({ tone: "amber", icon: Gauge, title: `${blockedRuns.length} batch(es) stopped by the usage budget`, detail: "Those batches produced no coverage. The queued work is preserved and will resume when the limit allows." });
    }

    if (!verified.length) {
      out.push({ tone: "red", icon: PowerOff, title: "No verified monitoring source exists", detail: "Collection cannot run. Nothing is being monitored, so absence of alerts carries no meaning." });
    }

    return out;
  }, [config, sources, queue, jobs, runs, pendingPublications]);

  if (!alerts.length) {
    return (
      <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12px] text-emerald-900">
        No limitation detected in the currently loaded records. A collection timestamp alone is not scheduled-execution evidence; verify the platform workflow run and its processed scope separately.
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-1.5">
      {alerts.map((alert, index) => {
        const Icon = alert.icon;
        const tone = alert.tone === "red" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900";
        return (
          <div key={index} className={`flex items-start gap-2 rounded-md border px-3.5 py-2.5 ${tone}`}>
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[12px] font-semibold">{alert.title}</div>
              <div className="text-[11.5px] leading-relaxed opacity-90">{alert.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}