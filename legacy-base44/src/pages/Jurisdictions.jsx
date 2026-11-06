import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/PageHeader";
import FilterBar from "@/components/FilterBar";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { CLASSIFICATION_TONE, OWNERSHIP_TONE, fmtDate } from "@/lib/format";
import { Globe2, Upload } from "lucide-react";

export default function Jurisdictions() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [classification, setClassification] = useState("");
  const [owner, setOwner] = useState("");
  const [ownership, setOwnership] = useState("");
  const [monitoring, setMonitoring] = useState("");

  useEffect(() => {
    (async () => {
      const page = await base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 });
      setRows(page.items || []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (classification && row.internal_classification !== classification) return false;
      if (owner && (row.primary_owner_team || "Unassigned") !== owner) return false;
      if (ownership && row.ownership_status !== ownership) return false;
      if (monitoring && row.monitoring_status !== monitoring) return false;
      if (!term) return true;
      return [row.name, row.name_raw, row.jurisdiction_id, row.parent_jurisdiction, (row.review_flags || []).join(" ")]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [rows, search, classification, owner, ownership, monitoring]);

  const counts = useMemo(() => rows.reduce((acc, row) => {
    acc[row.internal_classification] = (acc[row.internal_classification] || 0) + 1;
    if (row.ownership_status !== "Assigned") acc._unassigned = (acc._unassigned || 0) + 1;
    return acc;
  }, {}), [rows]);

  const columns = [
    {
      key: "jurisdiction_id",
      header: "Master ID",
      width: "110px",
      render: (row) => <span className="font-mono text-[11.5px] text-slate-500">{row.jurisdiction_id}</span>,
    },
    {
      key: "name",
      header: "Jurisdiction",
      render: (row) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{row.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span>{row.territory_scope}</span>
            {row.parent_jurisdiction && <span>· {row.parent_jurisdiction}</span>}
            {row.name_raw !== row.name && <span className="text-amber-700">· original: "{row.name_raw}"</span>}
            {(row.review_flags || []).length > 0 && (
              <span className="text-amber-700">· {row.review_flags.length} flag(s)</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "internal_classification",
      header: "Internal classification",
      render: (row) => (
        <StatusBadge tone={CLASSIFICATION_TONE[row.internal_classification] || "unknown"}>{row.internal_classification}</StatusBadge>
      ),
    },
    {
      key: "owner",
      header: "Accountable owner",
      render: (row) => (
        <div className="space-y-1">
          <div className="text-[12px] text-slate-800">{row.primary_owner_team || "Unassigned"}</div>
          <StatusBadge tone={OWNERSHIP_TONE[row.ownership_status] || "unknown"}>
            {row.ownership_status || "Unknown"}
          </StatusBadge>
        </div>
      ),
    },
    {
      key: "monitoring_status",
      header: "Monitoring",
      render: (row) => {
        const tone = row.monitoring_status === "Monitored"
          ? "success"
          : row.monitoring_status === "Partially monitored"
            ? "info"
            : row.monitoring_status === "Sources awaiting verification"
              ? "warning"
              : "unknown";
        return <StatusBadge tone={tone}>{row.monitoring_status || "No sources configured"}</StatusBadge>;
      },
    },
    {
      key: "legal_verification_status",
      header: "Legal verification",
      render: (row) => (
        <span className={row.legal_verification_status === "Verified" ? "text-emerald-700" : "text-slate-500"}>
          {row.legal_verification_status || "Not verified"}
        </span>
      ),
    },
    {
      key: "source_period",
      header: "Source row",
      render: (row) => (
        <span className="font-mono text-[11px] text-slate-400">
          {row.import_row_key || "—"}
          {row.source_row ? ` (row ${row.source_row})` : ""}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Master register"
        title="Jurisdictions"
        description="One record per jurisdiction or territorial scope, preserving the original imported name, classification and review flags. Internal classification is not a legal determination."
        actions={
          <Link to="/discovery" className="inline-flex items-center gap-2 rounded-sm bg-slate-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-slate-800">
            <Upload className="h-3.5 w-3.5" /> Import / discovery
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Master records", rows.length],
          ["Licensed", counts["Licensed Jurisdiction"] || 0],
          ["Conditionally permitted", counts["Conditionally Permitted"] || 0],
          ["Prohibited (internal)", counts["Prohibited Territory"] || 0],
          ["Awaiting ownership", counts._unassigned || 0],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-4 py-3">
            <div className="num text-[20px] font-semibold text-slate-900">{value}</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <SectionCard
        title={`${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
        description="Rows are source rows, not necessarily unique jurisdictions — duplicates remain visible until a person decides."
        bodyClassName=""
      >
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search name, master ID, flag…"
          filters={[
            { key: "class", label: "Classification", value: classification, onChange: setClassification, options: Object.keys(CLASSIFICATION_TONE).filter((k) => k !== "Unknown") },
            { key: "owner", label: "Owner", value: owner, onChange: setOwner, options: ["Regulatory Compliance", "Technical Compliance", "Unassigned"] },
            { key: "ownership", label: "Ownership", value: ownership, onChange: setOwnership, options: ["Assigned", "Ownership review"] },
            { key: "monitoring", label: "Monitoring", value: monitoring, onChange: setMonitoring, options: ["No sources configured", "Sources awaiting verification", "Partially monitored", "Monitored"] },
          ]}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          onRowClick={(row) => navigate(`/jurisdictions/${row.jurisdiction_id}`)}
          empty={
            <EmptyState
              icon={Globe2}
              title="No jurisdiction records yet"
              description="Import the register's Import_Staging sheet to create the master register. Source discovery and monitoring also wait on this step."
              action={
                <Link to="/discovery" className="rounded-sm bg-slate-900 px-3 py-2 text-[12.5px] font-medium text-white">
                  Open import review
                </Link>
              }
            />
          }
        />
      </SectionCard>

      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        Master records are linked, not merged: "Caymen Islands" and "Cayman Islands" stay separate with a duplicate flag until
        a reviewer decides. Created {rows.length ? fmtDate(rows[rows.length - 1].created_date) : "—"} onwards.
      </p>

    </>
  );
}