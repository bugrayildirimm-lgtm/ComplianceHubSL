import SectionCard from "@/components/SectionCard";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { Search } from "lucide-react";

// Leads only: every row is model-reported search output, never a retrieved document.
export default function SearchLeadList({ rows, loading, title, description }) {
  return (
    <SectionCard title={title} description={description}>
      <DataTable
        loading={loading}
        rowKey="id"
        rows={rows}
        columns={[
          {
            key: "lead",
            header: "Lead",
            render: (row) => (
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{row.title || "Untitled result"}</div>
                <a href={row.url} target="_blank" rel="noreferrer noopener" className="block max-w-[520px] truncate font-mono text-[11px] text-green-800 hover:underline">{row.url}</a>
                {row.note && <div className="mt-0.5 max-w-[560px] text-[11px] leading-snug text-slate-600">{row.note}</div>}
              </div>
            ),
          },
          {
            key: "reported",
            header: "Model-reported date",
            render: (row) => <span className="num text-[11px] text-slate-600">{row.publication_date || "not stated"}</span>,
          },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <StatusBadge tone="warning" dot={false}>
                {row.duplicate_note || "Unverified lead"}
              </StatusBadge>
            ),
          },
        ]}
        empty={<EmptyState icon={Search} title="No leads yet" description="A search returns model-reported leads only. Nothing is retrieved, verified or approved by this step." />}
      />
    </SectionCard>
  );
}