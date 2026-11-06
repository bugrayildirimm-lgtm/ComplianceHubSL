import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

// Readiness counts for batch verification. Nothing here approves a source: verification
// stays a recorded human decision on the existing batch screen.
export default function VerificationReadiness() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const base = { is_fixture: { $ne: true }, verification_status: "Awaiting source verification" };
      const [total, withEvidence, withTopics, withTitle] = await Promise.all([
        base44.entities.Source.count(base),
        base44.entities.Source.count({ ...base, publisher_evidence: { $regex: ".+" } }),
        base44.entities.Source.count({ ...base, topics: { $exists: true, $ne: [] } }),
        base44.entities.Source.count({ ...base, retrieval_page_title: { $regex: ".+" } }),
      ]);
      setStats({ total, withEvidence, withTopics, withTitle });
    })();
  }, []);

  if (!stats) return <div className="border-b border-border px-4 py-2 text-[11.5px] text-muted-foreground">Counting pending candidates…</div>;

  const items = [
    ["Pending candidates", stats.total, "awaiting a human decision"],
    ["With recorded publisher evidence", stats.withEvidence, "provenance note present"],
    ["With topic scope recorded", stats.withTopics, "what the source actually covers"],
    ["With a retrieval page title", stats.withTitle, "a page was actually opened"],
  ];

  return (
    <div className="grid gap-px border-b border-border bg-border sm:grid-cols-4">
      {items.map(([label, value, note]) => (
        <div key={label} className="bg-white px-4 py-2.5">
          <div className="num text-[17px] font-semibold text-slate-900">{value}</div>
          <div className="text-[11.5px] font-medium text-slate-700">{label}</div>
          <div className="text-[11px] text-muted-foreground">{note}</div>
        </div>
      ))}
      <div className="bg-white px-4 py-2 text-[11px] leading-relaxed text-slate-600 sm:col-span-4">
        Prepared for efficient review: candidates carrying publisher evidence and a stated topic scope can be confirmed in a batch, and gaps are visible before review. Nothing is auto-approved, and a daily capture never requires re-approval once a source is verified.
      </div>
    </div>
  );
}