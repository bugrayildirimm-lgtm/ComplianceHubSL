import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { logAudit, callFunction } from "@/lib/audit";
import PageHeader from "@/components/PageHeader";
import FilterBar from "@/components/FilterBar";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { APPLICABILITY_TONE, APPROVAL_TONE, CATEGORIES, IMPLEMENTATION_TONE, fmtDate } from "@/lib/format";
import { BookOpen, Plus } from "lucide-react";

const EMPTY = {
  title: "", jurisdiction_id: "", category: CATEGORIES[0], regulated_party: "Supplier",
  authority: "", instrument: "", article_reference: "", source_url: "", source_excerpt: "",
  internal_interpretation: "", applicability_rationale: "",
};

export default function RequirementsLibrary() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [approval, setApproval] = useState("");
  const [applicability, setApplicability] = useState("");
  const [implementation, setImplementation] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [page, jPage] = await Promise.all([
      base44.entities.Requirement.filter({ is_fixture: { $ne: true } }, { sort: "-created_date", limit: 500 }),
      base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 }),
    ]);
    setRows(page.items || []);
    setJurisdictions(jPage.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (category && row.category !== category) return false;
      if (approval && row.approval_status !== approval) return false;
      if (applicability && row.applicability_status !== applicability) return false;
      if (implementation && row.implementation_status !== implementation) return false;
      if (jurisdiction && row.jurisdiction_id !== jurisdiction) return false;
      if (!term) return true;
      return [row.requirement_id, row.title, row.authority, row.instrument, row.jurisdiction_name]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    });
  }, [rows, search, category, approval, applicability, implementation, jurisdiction]);

  const create = async () => {
    setBusy(true);
    setMessage("");
    const selected = jurisdictions.find((j) => j.jurisdiction_id === form.jurisdiction_id);
    try {
      const result = await callFunction("requirementWrite", {
        op: "createCandidate",
        ...form,
        jurisdiction_name: selected?.name || "",
        territorial_scope: selected?.territory_scope || "Unknown",
        responsible_team: selected?.primary_owner_team || "Unassigned",
      });
      if (result?.error) throw new Error(result.error);
      const requirementId = result.requirement.requirement_id;
      await logAudit({
        eventType: "Requirement candidate created",
        entityType: "Requirement",
        entityId: requirementId,
        entityLabel: form.title,
        summary: `Candidate requirement ${requirementId} created manually for ${selected?.name || "unknown jurisdiction"}.`,
      });
      setMessage(`Candidate ${requirementId} created — it needs source evidence and approval.`);
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: "requirement_id", header: "ID", width: "92px", render: (r) => <span className="font-mono text-[11px] text-slate-500">{r.requirement_id}</span> },
    {
      key: "title",
      header: "Requirement",
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{r.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {r.authority || "Authority unknown"}{r.article_reference ? ` · ${r.article_reference}` : ""}
            {r.ai_generated ? " · AI-drafted" : ""}
          </div>
        </div>
      ),
    },
    { key: "jurisdiction_name", header: "Jurisdiction", render: (r) => r.jurisdiction_name || "Unknown" },
    { key: "category", header: "Category", render: (r) => <span className="text-[11.5px]">{r.category}</span> },
    { key: "obligation_type", header: "Type", render: (r) => <span className="text-[11.5px] text-slate-600">{r.obligation_type || "Unknown"}</span> },
    { key: "approval_status", header: "Approval", render: (r) => <StatusBadge tone={APPROVAL_TONE[r.approval_status] || "unknown"}>{r.approval_status}</StatusBadge> },
    { key: "applicability_status", header: "Applicability", render: (r) => <StatusBadge tone={APPLICABILITY_TONE[r.applicability_status] || "unknown"} dot={false}>{r.applicability_status}</StatusBadge> },
    { key: "implementation_status", header: "Implementation", render: (r) => <StatusBadge tone={IMPLEMENTATION_TONE[r.implementation_status] || "unknown"} dot={false}>{r.implementation_status}</StatusBadge> },
    { key: "effective_date", header: "Effective", render: (r) => <span className="num text-[11.5px]">{r.future_effective_date ? fmtDate(r.future_effective_date) : r.effective_date ? fmtDate(r.effective_date) : "Unknown"}</span> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Source-backed baseline"
        title="Requirements Library"
        description="One specific obligation per record, with the official wording, the internal interpretation and the implementation state kept separate. Unknown is not 'not applicable', and missing evidence is not 'compliant'."
        actions={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-sm bg-slate-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" /> New requirement
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        {[
          ["Approved", rows.filter((r) => r.approval_status === "Approved").length, "reviewed and approved"],
          ["Unreviewed candidates", rows.filter((r) => r.approval_status === "Candidate — unreviewed").length, "AI or manual drafts"],
          ["Implementation unknown", rows.filter((r) => r.approval_status === "Approved" && r.implementation_status === "Unknown").length, "not evidence of compliance"],
          ["Applicability unknown", rows.filter((r) => r.applicability_status === "Unknown").length, "deliberately unresolved"],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-4 py-3">
            <div className="num text-[19px] font-semibold text-slate-900">{value}</div>
            <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
            <div className="text-[11px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <SectionCard title="New requirement candidate" description="Record one specific obligation with its source evidence. Approval is a separate, gated step." className="mb-5">
          <div className="grid gap-2.5 px-4 py-3 sm:grid-cols-2">
            <Field label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="One obligation, stated precisely" />
            <label className="text-[11.5px] text-slate-600">
              Jurisdiction
              <select value={form.jurisdiction_id} onChange={(e) => setForm({ ...form, jurisdiction_id: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                <option value="">Select jurisdiction…</option>
                {jurisdictions.map((j) => <option key={j.id} value={j.jurisdiction_id}>{j.name}</option>)}
              </select>
            </label>
            <label className="text-[11.5px] text-slate-600">
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-[11.5px] text-slate-600">
              Regulated party
              <select value={form.regulated_party} onChange={(e) => setForm({ ...form, regulated_party: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                {["Supplier", "Operator", "Studio", "Other", "Unknown"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <Field label="Authority" value={form.authority} onChange={(v) => setForm({ ...form, authority: v })} />
            <Field label="Instrument" value={form.instrument} onChange={(v) => setForm({ ...form, instrument: v })} />
            <Field label="Article / section / paragraph" value={form.article_reference} onChange={(v) => setForm({ ...form, article_reference: v })} />
            <Field label="Official source URL" value={form.source_url} onChange={(v) => setForm({ ...form, source_url: v })} placeholder="https://" />
            <Area label="Official wording (verbatim)" value={form.source_excerpt} onChange={(v) => setForm({ ...form, source_excerpt: v })} />
            <Area label="Internal interpretation" value={form.internal_interpretation} onChange={(v) => setForm({ ...form, internal_interpretation: v })} />
            <Area label="Applicability rationale" value={form.applicability_rationale} onChange={(v) => setForm({ ...form, applicability_rationale: v })} />
            <div className="flex items-center gap-3 sm:col-span-2">
              <button
                type="button"
                onClick={create}
                disabled={busy || !form.title || !form.jurisdiction_id}
                className="rounded-sm bg-green-800 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
              >
                {busy ? "Saving…" : "Create candidate"}
              </button>
              {message && <span className="text-[11.5px] text-slate-600">{message}</span>}
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title={`${filtered.length} requirement${filtered.length === 1 ? "" : "s"}`}>
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search title, authority, ID…"
          filters={[
            { key: "cat", label: "Category", value: category, onChange: setCategory, options: CATEGORIES },
            { key: "appr", label: "Approval", value: approval, onChange: setApproval, options: Object.keys(APPROVAL_TONE) },
            { key: "appl", label: "Applicability", value: applicability, onChange: setApplicability, options: Object.keys(APPLICABILITY_TONE) },
            { key: "impl", label: "Implementation", value: implementation, onChange: setImplementation, options: Object.keys(IMPLEMENTATION_TONE) },
            { key: "jur", label: "Jurisdiction", value: jurisdiction, onChange: setJurisdiction, options: jurisdictions.map((j) => ({ value: j.jurisdiction_id, label: j.name })) },
          ]}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          onRowClick={(row) => navigate(`/requirements/${row.id}`)}
          empty={
            <EmptyState
              icon={BookOpen}
              title="The library is empty"
              description="Baseline research is separate from monitoring. Nothing is assumed: requirements appear only once official instruments have been researched and recorded."
            />
          }
        />
      </SectionCard>
    </>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="text-[11.5px] text-slate-600">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]"
      />
    </label>
  );
}

function Area({ label, value, onChange }) {
  return (
    <label className="text-[11.5px] text-slate-600 sm:col-span-2">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]"
      />
    </label>
  );
}