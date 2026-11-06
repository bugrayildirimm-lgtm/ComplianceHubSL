import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { logAudit } from "@/lib/audit";
import { nextClientRef } from "@/lib/refs";
import useActor from "@/lib/useActor";
import PageHeader from "@/components/PageHeader";
import FilterBar from "@/components/FilterBar";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { PRIORITY_TONE, fmtDate, isOverdue, daysUntil } from "@/lib/format";
import { ListChecks, Plus } from "lucide-react";

const STATUSES = ["Open", "In progress", "Blocked", "Evidence submitted", "Closed"];
const STATUS_TONE = { Open: "info", "In progress": "warning", Blocked: "danger", "Evidence submitted": "accent", Closed: "success" };

export default function ActionsDeadlines() {
  const actor = useActor();
  const [actions, setActions] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [team, setTeam] = useState("");
  const [priority, setPriority] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editor, setEditor] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", owner_team: "", owner: "", due_date: "", priority: "Medium", affected_scope: "", jurisdiction_id: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [page, jPage] = await Promise.all([
      base44.entities.ActionItem.list({ sort: "-created_date", limit: 500 }),
      base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 }),
    ]);
    setActions(page.items || []);
    setJurisdictions(jPage.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return actions.filter((action) => {
      if (status && action.status !== status) return false;
      if (team && action.owner_team !== team) return false;
      if (priority && action.priority !== priority) return false;
      if (overdueOnly && !(isOverdue(action.due_date) && action.status !== "Closed")) return false;
      if (!term) return true;
      return [action.action_ref, action.title, action.owner, action.affected_scope]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [actions, search, status, team, priority, overdueOnly]);

  const overdue = actions.filter((a) => isOverdue(a.due_date) && a.status !== "Closed");
  const dueSoon = actions.filter((a) => {
    const days = daysUntil(a.due_date);
    return days !== null && days >= 0 && days <= 7 && a.status !== "Closed";
  });
  const noOwner = actions.filter((a) => !a.owner && a.status !== "Closed");

  const openEditor = (action) => {
    setSelected(action);
    setEditor({
      status: action.status,
      owner: action.owner || "",
      owner_team: action.owner_team || "",
      due_date: action.due_date || "",
      completion_evidence: action.completion_evidence || "",
    });
  };

  const saveEditor = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (["Evidence submitted", "Closed"].includes(editor.status) && !editor.completion_evidence.trim()) {
        throw new Error("Record the completion evidence before moving to this status.");
      }
      const patch = {
        ...editor,
        completed_at: editor.status === "Closed" ? new Date().toISOString() : selected.completed_at || "",
        closed_by: editor.status === "Closed" ? actor.email || "" : selected.closed_by || "",
      };
      await base44.entities.ActionItem.update(selected.id, patch);
      await logAudit({
        eventType: "Action updated",
        entityType: "ActionItem",
        entityId: selected.action_ref,
        entityLabel: selected.title,
        summary: `Action ${selected.action_ref} set to ${editor.status}${editor.owner ? `, owner ${editor.owner}` : ""}.`,
        detail: editor.completion_evidence,
      });
      setMessage("Action updated and audited.");
      setSelected(null);
      setEditor(null);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setMessage("");
    try {
      const actionRef = await nextClientRef("ActionItem", "action_ref", "ACT", 4);
      const jurisdiction = jurisdictions.find((j) => j.jurisdiction_id === form.jurisdiction_id);
      await base44.entities.ActionItem.create({
        action_ref: actionRef,
        title: form.title,
        owner: form.owner,
        owner_team: form.owner_team || jurisdiction?.primary_owner_team || "Unassigned",
        due_date: form.due_date,
        priority: form.priority,
        status: "Open",
        affected_scope: form.affected_scope,
        jurisdiction_id: form.jurisdiction_id,
        jurisdiction_name: jurisdiction?.name || "",
        is_fixture: false,
      });
      await logAudit({
        eventType: "Action created",
        entityType: "ActionItem",
        entityId: actionRef,
        entityLabel: form.title,
        summary: `Action ${actionRef} created with due date ${form.due_date || "not set"}.`,
      });
      setForm({ title: "", owner_team: "", owner: "", due_date: "", priority: "Medium", affected_scope: "", jurisdiction_id: "" });
      setShowForm(false);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: "action_ref", header: "Ref", width: "86px", render: (a) => <span className="font-mono text-[11px] text-slate-500">{a.action_ref}</span> },
    {
      key: "title",
      header: "Action",
      render: (a) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{a.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {a.jurisdiction_name || "No jurisdiction"} · {a.affected_scope || "Scope not set"}
          </div>
        </div>
      ),
    },
    { key: "owner", header: "Owner", render: (a) => (
      <div className="text-[11.5px]">
        <div className={a.owner ? "text-slate-800" : "text-amber-700"}>{a.owner || "No named owner"}</div>
        <div className="text-muted-foreground">{a.owner_team || "Unassigned"}</div>
      </div>
    ) },
    { key: "due_date", header: "Due", render: (a) => (
      <div className="num text-[11.5px]">
        <div className={isOverdue(a.due_date) && a.status !== "Closed" ? "font-medium text-red-700" : "text-slate-700"}>
          {a.due_date ? fmtDate(a.due_date) : "Not set"}
        </div>
        {a.due_date && a.status !== "Closed" && (
          <div className="text-[10.5px] text-muted-foreground">
            {isOverdue(a.due_date) ? `${Math.abs(daysUntil(a.due_date))} day(s) overdue` : `in ${daysUntil(a.due_date)} day(s)`}
          </div>
        )}
      </div>
    ) },
    { key: "priority", header: "Priority", render: (a) => <StatusBadge tone={PRIORITY_TONE[a.priority] || "unknown"} dot={false}>{a.priority}</StatusBadge> },
    { key: "status", header: "Status", render: (a) => <StatusBadge tone={STATUS_TONE[a.status] || "unknown"}>{a.status}</StatusBadge> },
    { key: "evidence", header: "Evidence", render: (a) => (
      <span className={a.completion_evidence ? "text-emerald-700" : "text-slate-400"}>{a.completion_evidence ? "Recorded" : "None"}</span>
    ) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Implementation"
        title="Actions & Deadlines"
        description="Every action carries an owner, due date, affected scope and evidence of completion. Deadlines are business commitments, not legal effective dates."
        actions={
          <button type="button" onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-2 rounded-sm bg-slate-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" /> New action
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        {[
          ["Overdue", overdue.length, "past due, not closed"],
          ["Due within 7 days", dueSoon.length, "including today"],
          ["No named owner", noOwner.length, "team owner may exist"],
          ["Open", actions.filter((a) => a.status !== "Closed").length, "of all recorded actions"],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-4 py-3">
            <div className={`num text-[19px] font-semibold ${label === "Overdue" && value > 0 ? "text-red-700" : "text-slate-900"}`}>{value}</div>
            <div className="mt-0.5 text-[11.5px] font-medium text-slate-700">{label}</div>
            <div className="text-[11px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <SectionCard title="New action" className="mb-5">
          <div className="grid gap-2.5 px-4 py-3 sm:grid-cols-2">
            <label className="text-[11.5px] text-slate-600 sm:col-span-2">
              Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
            </label>
            <label className="text-[11.5px] text-slate-600">
              Jurisdiction
              <select value={form.jurisdiction_id} onChange={(e) => setForm({ ...form, jurisdiction_id: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                <option value="">None</option>
                {jurisdictions.map((j) => <option key={j.id} value={j.jurisdiction_id}>{j.name}</option>)}
              </select>
            </label>
            <label className="text-[11.5px] text-slate-600">
              Owner team
              <select value={form.owner_team} onChange={(e) => setForm({ ...form, owner_team: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                <option value="">Inherit from jurisdiction</option>
                {["Regulatory Compliance", "Technical Compliance", "Unassigned"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-[11.5px] text-slate-600">
              Named owner
              <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
            </label>
            <label className="text-[11.5px] text-slate-600">
              Due date
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
            </label>
            <label className="text-[11.5px] text-slate-600">
              Priority
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                {["Critical", "High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-[11.5px] text-slate-600">
              Affected scope
              <input value={form.affected_scope} onChange={(e) => setForm({ ...form, affected_scope: e.target.value })} placeholder="e.g. Slots RNG certificates" className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
            </label>
            <div className="flex items-center gap-3 sm:col-span-2">
              <button type="button" onClick={create} disabled={busy || !form.title} className="rounded-sm bg-green-800 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                Create action
              </button>
              {message && <span className="text-[11.5px] text-slate-600">{message}</span>}
            </div>
          </div>
        </SectionCard>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard title={`${filtered.length} action${filtered.length === 1 ? "" : "s"}`} className="xl:col-span-2">
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Search action, ref, owner…"
            filters={[
              { key: "status", label: "Status", value: status, onChange: setStatus, options: STATUSES },
              { key: "team", label: "Team", value: team, onChange: setTeam, options: ["Regulatory Compliance", "Technical Compliance", "Unassigned"] },
              { key: "priority", label: "Priority", value: priority, onChange: setPriority, options: ["Critical", "High", "Medium", "Low"] },
            ]}
            right={
              <label className="flex items-center gap-1.5 text-[11.5px] text-slate-600">
                <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
              </label>
            }
          />
          <DataTable
            columns={columns}
            rows={filtered}
            loading={loading}
            onRowClick={(row) => openEditor(row)}
            empty={<EmptyState icon={ListChecks} title="No actions recorded" description="Actions come from a reviewed impact assessment or a requirement gap — never generated automatically." />}
          />
        </SectionCard>

        <SectionCard title={selected ? `Update ${selected.action_ref}` : "Select an action"} description={selected ? selected.title : "Choose a row to record progress and completion evidence."}>
          {!selected ? (
            <EmptyState icon={ListChecks} title="Nothing selected" description="Status changes and completion evidence are recorded here with an audit trail." />
          ) : (
            <div className="space-y-2.5 px-4 py-3">
              <label className="block text-[11.5px] text-slate-600">
                Status
                <select value={editor.status} onChange={(e) => setEditor({ ...editor, status: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block text-[11.5px] text-slate-600">
                Named owner
                <input value={editor.owner} onChange={(e) => setEditor({ ...editor, owner: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
              </label>
              <label className="block text-[11.5px] text-slate-600">
                Due date
                <input type="date" value={editor.due_date} onChange={(e) => setEditor({ ...editor, due_date: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
              </label>
              <label className="block text-[11.5px] text-slate-600">
                Completion evidence
                <textarea value={editor.completion_evidence} onChange={(e) => setEditor({ ...editor, completion_evidence: e.target.value })} rows={4} placeholder="What was done, where the evidence is held, who verified it." className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]" />
              </label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={saveEditor} disabled={busy || !actor.canWrite} className="rounded-sm bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                  Save update
                </button>
                <button type="button" onClick={() => { setSelected(null); setEditor(null); }} className="text-[12px] text-slate-600 hover:text-slate-900">Cancel</button>
              </div>
              {message && <p className="text-[11.5px] text-slate-600">{message}</p>}
              {selected.linked_alert_id && <p className="text-[11px] text-slate-500">Linked to a regulatory alert.</p>}
              {selected.linked_requirement_id && <p className="text-[11px] text-slate-500">Linked requirement: {selected.linked_requirement_id}</p>}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}