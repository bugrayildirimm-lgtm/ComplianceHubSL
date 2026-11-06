import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { fmtDateTime } from "@/lib/format";
import { Gauge, ScanLine } from "lucide-react";

const CYCLE_TONE = {
  Completed: "success",
  Open: "info",
  "Incomplete — capacity limited": "danger",
  "Blocked — usage limit": "danger",
  "Not started": "unknown",
};

// Precise reporting of what a cycle actually retrieved. A listing capture never completes
// jurisdiction coverage, and a queued publication is unknown — not unchanged.
export default function CollectionScopePanel({ sources = [], jobs = [], config }) {
  const [docs, setDocs] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [docPage, linkPage] = await Promise.all([
        base44.entities.DocumentRecord.filter({ collection_mode: "Managed browser" }, { sort: "-fetched_at", limit: 400 }),
        base44.entities.CrawlLink.filter({ status: "Pending" }, { limit: 500 }),
      ]);
      setDocs(docPage.items || []);
      setLinks(linkPage.items || []);
      setLoading(false);
    })();
  }, []);

  const verified = sources.filter((s) => s.verification_status === "Verified");
  const cycleStatus = config?.cycle_status || "Not started";

  return (
    <SectionCard
      title="Collection scope — what was actually retrieved"
      description="Separate lines for page retrievals, publications discovered and processed, queued work and attachment gaps. None of these is a jurisdiction-wide clean result."
      actions={<StatusBadge tone={CYCLE_TONE[cycleStatus] || "unknown"}>Cycle {config?.cycle_id || "not opened"} · {cycleStatus}</StatusBadge>}
    >
      <div className="grid gap-px border-b border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Cycle opened", config?.cycle_opened_at ? fmtDateTime(config.cycle_opened_at) : "—", "Europe/Malta daily cycle"],
          ["Cycle closed", config?.cycle_closed_at ? fmtDateTime(config.cycle_closed_at) : "open or not run", config?.cycle_batch ? `batch ${config.cycle_batch}` : "no batch recorded"],
          ["Due sources in scope", config?.cycle_due_sources || 0, `${config?.cycle_processed_sources || 0} source(s) processed`],
          ["Queued publications", config?.cycle_pending_publications || 0, "observed but not yet captured"],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-4 py-3">
            <div className="num text-[15px] font-semibold text-slate-900">{value}</div>
            <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
            <div className="text-[11px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </div>

      {config?.cycle_shortfall && (
        <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-[11.5px] leading-relaxed text-red-900">
          <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <div className="font-semibold">Stated capacity shortfall</div>
            <div>{config.cycle_shortfall}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-4 py-6 text-[12px] text-muted-foreground">Loading collection scope…</div>
      ) : !verified.length ? (
        <EmptyState icon={ScanLine} title="No verified source" description="Without a verified source nothing can be retrieved, so no scope can be reported." />
      ) : (
        <div className="divide-y divide-border">
          {verified.map((source) => {
            const sourceDocs = docs.filter((d) => d.source_id === source.source_id);
            const publications = sourceDocs.filter((d) => /individual publication/i.test(d.capture_scope || ""));
            const listing = sourceDocs.find((d) => /listing/i.test(d.capture_scope || ""));
            const queuedNew = links.filter((l) => l.source_id === source.source_id && l.queue_kind === "New publication").length;
            const queuedRecheck = links.filter((l) => l.source_id === source.source_id && l.queue_kind === "Amendment recheck").length;
            const latestJob = jobs.find((j) => j.source_id === source.source_id);
            return (
              <div key={source.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-slate-900">{source.authority}</div>
                    <a href={source.url} target="_blank" rel="noreferrer noopener" className="block max-w-[560px] truncate font-mono text-[11px] text-green-800 hover:underline">
                      {source.url}
                    </a>
                    <div className="text-[11px] text-muted-foreground">{source.jurisdiction_name} · {source.source_type}</div>
                  </div>
                  <StatusBadge tone={source.health_status === "Failed or blocked" ? "danger" : source.crawl_pending ? "warning" : "neutral"} dot={false}>
                    {source.health_status || "No check recorded"}
                  </StatusBadge>
                </div>

                <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Last successful page retrieval</dt>
                    <dd className="text-slate-800">
                      {source.last_success_at ? fmtDateTime(source.last_success_at) : "never"}
                      {listing && <span className="block truncate font-mono text-[10.5px] text-slate-500">{listing.document_url}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Publications processed in this store</dt>
                    <dd className="text-slate-800">
                      <span className="num">{publications.length}</span> publication capture(s)
                      {latestJob?.finished_at && <span className="block text-slate-500">last job finished {fmtDateTime(latestJob.finished_at)}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Still queued</dt>
                    <dd className="text-slate-800">
                      <span className="num">{queuedNew}</span> new publication(s) · <span className="num">{queuedRecheck}</span> amendment recheck(s)
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Attachments / extraction</dt>
                    <dd className={source.format_gap ? "text-amber-900" : "text-slate-800"}>
                      {source.format_gap ? String(source.format_gap).slice(0, 220) : "No attachment gap recorded for the last capture"}
                    </dd>
                  </div>
                </dl>

                {source.crawl_stop_reason && (
                  <div className="mt-1.5 text-[10.5px] text-slate-500">Continuation: {source.crawl_stop_reason}</div>
                )}
                <div className="mt-1.5 rounded-sm border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] leading-snug text-slate-600">
                  Scope checked: this listing page{listing ? ` (${fmtDateTime(listing.fetched_at)})` : ""} and {publications.length} individually captured publication(s).
                  {" "}Jurisdiction coverage is not established by a listing visit or by an unchanged selected publication.
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-border bg-slate-50/60 px-4 py-2.5 text-[11px] leading-relaxed text-slate-600">
        {verified.length} verified source(s) out of the full register. Remaining jurisdictions and topics have no verified source at all, so their status is unknown — not compliant and not clean.
        {links.filter((l) => !l.queue_kind).length > 0 && (
          <span className="mt-1 block text-slate-500">
            A separate historical frontier of {links.filter((l) => !l.queue_kind).length} link(s) from the earlier traversal design is retained but is not part of the managed cycle and is not counted as queued publication work.
          </span>
        )}
      </div>
    </SectionCard>
  );
}