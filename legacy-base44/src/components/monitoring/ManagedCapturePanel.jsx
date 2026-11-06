import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import { fmtDateTime } from "@/lib/format";

export default function ManagedCapturePanel() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const page = await base44.entities.DocumentRecord.filter(
        { collection_mode: "Managed browser" },
        { sort: "-fetched_at", limit: 12 }
      );
      setDocs(page.items || []);
      setLoading(false);
    })();
  }, []);

  const withGaps = docs.filter((d) => d.attachment_gaps);

  return (
    <SectionCard
      title="Managed-browser captures"
      description="Exactly what the browser captured, how complete it is, and what could not be extracted. Listing captures are not publications."
    >
      <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
        {[
          ["Captures loaded", docs.length, "most recent first"],
          ["With attachment gaps", withGaps.length, "declared, never invented"],
          ["Awaiting human review", docs.filter((d) => /Pending|Draft|review/i.test(d.analysis_state || "")).length, "drafts are unreviewed"],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-4 py-2.5">
            <div className="num text-[17px] font-semibold text-slate-900">{value}</div>
            <div className="text-[11.5px] font-medium text-slate-700">{label}</div>
            <div className="text-[11px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="px-4 py-6 text-[12px] text-muted-foreground">Loading captures…</div>
      ) : docs.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-muted-foreground">
          No managed-browser capture yet. A successful homepage visit is not coverage.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {docs.map((doc) => (
            <div key={doc.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-slate-900">{doc.title || doc.authority}</div>
                  <a
                    href={doc.document_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block max-w-[640px] truncate font-mono text-[11px] text-green-800 hover:underline"
                  >
                    {doc.document_url}
                  </a>
                  <div className="mt-0.5 text-[11px] text-slate-600">{doc.capture_scope || "Scope not recorded"}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge tone={doc.extraction_status === "Complete" ? "success" : doc.extraction_status === "Failed" ? "danger" : "warning"} dot={false}>
                    {doc.completeness || doc.extraction_status}
                  </StatusBadge>
                  <span className="num text-[10.5px] text-muted-foreground">{doc.fetched_at ? fmtDateTime(doc.fetched_at) : "—"}</span>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-slate-500">
                <span>Evidence hash {String(doc.content_hash || "").slice(0, 12) || "—"}</span>
                <span>Substantive {String(doc.substantive_hash || "").slice(0, 12) || "not compared"}</span>
                <span>Extractor {doc.extractor_version || "—"}</span>
                <span>{doc.publication_date_evidenced || "No date evidenced"}</span>
                <span>{doc.legal_stage_evidenced || "Stage not evidenced"}</span>
              </div>
              {doc.attachment_gaps && (
                <div className="mt-1.5 rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
                  Attachment gap: {doc.attachment_gaps}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}