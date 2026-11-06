import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { logAudit } from "@/lib/audit";
import { nextClientRef } from "@/lib/refs";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import { fmtDate } from "@/lib/format";
import { ShieldCheck } from "lucide-react";

const TABS = [
  { key: "licences", label: "Licences & certificates" },
  { key: "studios", label: "Live studios" },
  { key: "profiles", label: "Market profiles" },
  { key: "entities", label: "Entities & products" },
];

const LICENCE_TONE = { Active: "success", Pending: "warning", Suspended: "danger", Expired: "neutral", Unknown: "unknown" };

export default function LicencesStudios() {
  const [tab, setTab] = useState("licences");
  const [data, setData] = useState({ licences: [], studios: [], profiles: [], entities: [], products: [], jurisdictions: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    const [licences, studios, profiles, entities, products, jurisdictions] = await Promise.all([
      base44.entities.LicenceCertificate.list({ sort: "-created_date", limit: 300 }),
      base44.entities.LiveStudio.list({ limit: 200 }),
      base44.entities.MarketProfile.list({ limit: 300 }),
      base44.entities.LegalEntity.list({ limit: 200 }),
      base44.entities.GameProduct.list({ limit: 300 }),
      base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 }),
    ]);
    setData({
      licences: licences.items || [],
      studios: studios.items || [],
      profiles: profiles.items || [],
      entities: entities.items || [],
      products: products.items || [],
      jurisdictions: jurisdictions.items || [],
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setForm({}); setMessage(""); setShowForm(false); }, [tab]);

  const jurisdictionOptions = data.jurisdictions.map((j) => ({ value: j.jurisdiction_id, label: j.name }));

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const match = (values) => !term || values.filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    return {
      licences: data.licences.filter((r) => match([r.record_type, r.jurisdiction_name, r.legal_entity_name, r.product_name, r.authority, r.reference_number])),
      studios: data.studios.filter((r) => match([r.studio_name, r.physical_jurisdiction, (r.destination_markets || []).join(" ")])),
      profiles: data.profiles.filter((r) => match([r.jurisdiction_name, r.legal_entity_name, r.product_type, r.product_name, r.permission_status])),
      entities: data.entities.filter((r) => match([r.entity_name, r.jurisdiction_of_incorporation, r.entity_role])),
      products: data.products.filter((r) => match([r.product_name, r.product_type, r.studio])),
    };
  }, [data, search]);

  const create = async () => {
    setBusy(true);
    setMessage("");
    try {
      const jurisdiction = data.jurisdictions.find((j) => j.jurisdiction_id === form.jurisdiction_id);
      if (tab === "licences") {
        if (!form.record_type || !form.jurisdiction_id) throw new Error("Record type and jurisdiction are required.");
        await base44.entities.LicenceCertificate.create({
          record_ref: await nextClientRef("LicenceCertificate", "record_ref", "LIC", 4),
          record_type: form.record_type,
          jurisdiction_id: form.jurisdiction_id,
          jurisdiction_name: jurisdiction?.name || "",
          legal_entity_name: form.legal_entity_name || "",
          product_name: form.product_name || "",
          authority: form.authority || "",
          reference_number: form.reference_number || "",
          status: form.status || "Unknown",
          issued_date: form.issued_date || "",
          expiry_date: form.expiry_date || "",
          evidence_status: form.evidence_file_uri ? "Evidence uploaded" : "No evidence on file",
          evidence_file_uri: form.evidence_file_uri || "",
          evidence_note: form.evidence_note || "",
        });
      } else if (tab === "studios") {
        if (!form.studio_name) throw new Error("Studio name is required.");
        await base44.entities.LiveStudio.create({
          studio_code: form.studio_code || "",
          studio_name: form.studio_name,
          physical_jurisdiction: form.physical_jurisdiction || "",
          physical_location_detail: form.physical_location_detail || "",
          destination_markets: (form.destination_markets || "").split(",").map((s) => s.trim()).filter(Boolean),
          premises_approval_status: form.premises_approval_status || "Unknown",
          operations_status: "Operating",
        });
      } else if (tab === "profiles") {
        if (!form.jurisdiction_id || !form.product_type) throw new Error("Jurisdiction and product type are required.");
        await base44.entities.MarketProfile.create({
          jurisdiction_id: form.jurisdiction_id,
          jurisdiction_name: jurisdiction?.name || "",
          legal_entity_name: form.legal_entity_name || "",
          product_type: form.product_type,
          product_name: form.product_name || "",
          permission_status: form.permission_status || "Unknown",
          certificate_activity_confirmed: false,
          basis_notes: form.basis_notes || "",
          owner_team: jurisdiction?.primary_owner_team || "Unassigned",
          owner_status: jurisdiction?.ownership_status === "Assigned" ? "Assigned" : "Ownership review",
        });
      } else {
        if (!form.entity_name && !form.product_name) throw new Error("Enter an entity or a product name.");
        if (form.entity_name) {
          await base44.entities.LegalEntity.create({
            entity_code: form.entity_code || "",
            entity_name: form.entity_name,
            jurisdiction_of_incorporation: form.jurisdiction_of_incorporation || "",
            entity_role: form.entity_role || "Unknown",
            licence_holder: Boolean(form.licence_holder),
            status: "Active",
          });
        }
        if (form.product_name) {
          await base44.entities.GameProduct.create({
            product_code: form.product_code || "",
            product_name: form.product_name,
            product_type: form.product_type || "Slot",
            studio: form.studio || "",
            supplier_entity: form.supplier_entity || "",
            status: "Live",
          });
        }
      }
      await logAudit({
        eventType: "Linked record created",
        entityType: tab,
        entityId: form.record_type || form.studio_name || form.product_type || form.entity_name || form.product_name,
        entityLabel: jurisdiction?.name || "",
        summary: `Created a ${tab} record for ${jurisdiction?.name || form.studio_name || "the group"}.`,
      });
      setMessage("Record created.");
      setShowForm(false);
      setForm({});
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateLicenceStatus = async (record, status) => {
    await base44.entities.LicenceCertificate.update(record.id, { status });
    await logAudit({
      eventType: "Licence status changed",
      entityType: "LicenceCertificate",
      entityId: record.record_ref,
      entityLabel: `${record.record_type} — ${record.jurisdiction_name}`,
      summary: `Status changed to ${status}.`,
    });
    load();
  };

  return (
    <>
      <PageHeader
        eyebrow="Linked records"
        title="Licences, Certificates & Studios"
        description="Licences, game certifications, live studios, legal entities and destination-market profiles are linked but distinct. Nothing here is inferred from the internal classification."
        actions={
          <button type="button" onClick={() => setShowForm((v) => !v)} className="rounded-sm bg-slate-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-slate-800">
            Add {TABS.find((t) => t.key === tab).label.toLowerCase().replace(/ & .*/, "")} record
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] transition-colors ${tab === item.key ? "border-green-700 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <SectionCard
        title={TABS.find((t) => t.key === tab).label}
        description={tab === "profiles" ? "A market profile links destination jurisdiction, entity and product — the same jurisdiction may differ per product line." : tab === "studios" ? "The studio's physical location is separate from the destination markets that receive its games." : undefined}
      >
        <FilterBar search={search} onSearch={setSearch} placeholder="Search records…" />
        {showForm && (
          <div className="border-b border-border bg-slate-50/50 px-4 py-3">
            <FormFields tab={tab} form={form} setForm={setForm} jurisdictionOptions={jurisdictionOptions} />
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={create} disabled={busy} className="rounded-sm bg-green-800 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                Save record
              </button>
              {message && <span className="text-[11.5px] text-slate-600">{message}</span>}
            </div>
          </div>
        )}

        {tab === "licences" && (
          <DataTable
            loading={loading}
            rows={filtered.licences}
            columns={[
              { key: "record_type", header: "Type", render: (r) => <span className="font-medium text-slate-900">{r.record_type}</span> },
              { key: "jurisdiction_name", header: "Jurisdiction", render: (r) => r.jurisdiction_name || "Unknown" },
              { key: "legal_entity_name", header: "Entity / product", render: (r) => <span className="text-[11.5px]">{r.legal_entity_name || "Unknown"}{r.product_name ? ` · ${r.product_name}` : ""}</span> },
              { key: "reference_number", header: "Reference", render: (r) => <span className="font-mono text-[11px] text-slate-600">{r.reference_number || "Unknown"}</span> },
              { key: "validity", header: "Validity", render: (r) => <span className="num text-[11.5px]">{r.issued_date ? fmtDate(r.issued_date) : "—"} → {r.expiry_date ? fmtDate(r.expiry_date) : "unknown"}</span> },
              { key: "evidence", header: "Evidence", render: (r) => <StatusBadge tone={r.evidence_status === "Evidence verified" ? "success" : r.evidence_status === "Evidence uploaded" ? "warning" : "danger"} dot={false}>{r.evidence_status}</StatusBadge> },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <select
                    value={r.status}
                    onChange={(e) => updateLicenceStatus(r, e.target.value)}
                    className="h-7 rounded-sm border border-border bg-white px-1.5 text-[11.5px]"
                  >
                    {Object.keys(LICENCE_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ),
              },
            ]}
            empty={<EmptyState icon={ShieldCheck} title="No licences or certificates recorded" description="Licences are recorded from evidence. An internal 'Licensed Jurisdiction' classification never creates a licence record." />}
          />
        )}

        {tab === "studios" && (
          <DataTable
            loading={loading}
            rows={filtered.studios}
            columns={[
              { key: "studio_name", header: "Studio", render: (r) => <span className="font-medium text-slate-900">{r.studio_name}</span> },
              { key: "physical_jurisdiction", header: "Physical location", render: (r) => r.physical_jurisdiction || "Unknown" },
              { key: "destination_markets", header: "Destination markets", render: (r) => (r.destination_markets || []).join(", ") || <span className="text-amber-700">Not established</span> },
              { key: "premises_approval_status", header: "Premises approval", render: (r) => <StatusBadge tone={r.premises_approval_status === "Approved" ? "success" : r.premises_approval_status === "Unknown" ? "unknown" : "warning"} dot={false}>{r.premises_approval_status}</StatusBadge> },
              { key: "operations_status", header: "Operations", render: (r) => r.operations_status || "Unknown" },
            ]}
            empty={<EmptyState icon={ShieldCheck} title="No live studios recorded" description="Add the studio's physical location, then link destination markets separately." />}
          />
        )}

        {tab === "profiles" && (
          <DataTable
            loading={loading}
            rows={filtered.profiles}
            columns={[
              { key: "jurisdiction_name", header: "Destination jurisdiction", render: (r) => <span className="font-medium text-slate-900">{r.jurisdiction_name || "Unknown"}</span> },
              { key: "product_type", header: "Product line", render: (r) => r.product_type },
              { key: "legal_entity_name", header: "Entity", render: (r) => r.legal_entity_name || "Unknown" },
              { key: "permission_status", header: "Permission", render: (r) => <StatusBadge tone={r.permission_status === "Licensed" ? "success" : r.permission_status === "Internal prohibition" ? "danger" : r.permission_status === "Unknown" ? "unknown" : "info"} dot={false}>{r.permission_status}</StatusBadge> },
              { key: "owner_team", header: "Owner", render: (r) => r.owner_team || "Unassigned" },
              { key: "basis_notes", header: "Basis", render: (r) => <span className="text-[11.5px] text-slate-600">{r.basis_notes || "Not recorded"}</span> },
            ]}
            empty={<EmptyState icon={ShieldCheck} title="No market profiles" description="Profiles are created only once product scope is established for the jurisdiction." />}
          />
        )}

        {tab === "entities" && (
          <div className="grid gap-px bg-border lg:grid-cols-2">
            <div className="bg-white">
              <div className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Legal entities</div>
              <DataTable
                loading={loading}
                rows={filtered.entities}
                columns={[
                  { key: "entity_name", header: "Entity", render: (r) => <span className="font-medium text-slate-900">{r.entity_name}</span> },
                  { key: "jurisdiction_of_incorporation", header: "Incorporated", render: (r) => r.jurisdiction_of_incorporation || "Unknown" },
                  { key: "entity_role", header: "Role", render: (r) => r.entity_role },
                ]}
                empty={<EmptyState title="No entities recorded" description="Add the entities that hold licences or supply games." />}
              />
            </div>
            <div className="bg-white">
              <div className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Games & products</div>
              <DataTable
                loading={loading}
                rows={filtered.products}
                columns={[
                  { key: "product_name", header: "Product", render: (r) => <span className="font-medium text-slate-900">{r.product_name}</span> },
                  { key: "product_type", header: "Type", render: (r) => r.product_type },
                  { key: "studio", header: "Studio", render: (r) => r.studio || "—" },
                ]}
                empty={<EmptyState title="No products recorded" description="Slots, live casino games and studio operations are tracked separately." />}
              />
            </div>
          </div>
        )}
      </SectionCard>
    </>
  );
}

function FormFields({ tab, form, setForm, jurisdictionOptions }) {
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const input = "mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]";
  const label = "text-[11.5px] text-slate-600";

  if (tab === "licences") {
    return (
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className={label}>Type
          <select value={form.record_type || "Supplier licence"} onChange={set("record_type")} className={input}>
            {["Supplier licence", "Game certification", "Studio approval", "Other"].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className={label}>Jurisdiction
          <select value={form.jurisdiction_id || ""} onChange={set("jurisdiction_id")} className={input}>
            <option value="">Select…</option>
            {jurisdictionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={label}>Authority
          <input value={form.authority || ""} onChange={set("authority")} className={input} />
        </label>
        <label className={label}>Legal entity
          <input value={form.legal_entity_name || ""} onChange={set("legal_entity_name")} className={input} />
        </label>
        <label className={label}>Product (if certification)
          <input value={form.product_name || ""} onChange={set("product_name")} className={input} />
        </label>
        <label className={label}>Reference number
          <input value={form.reference_number || ""} onChange={set("reference_number")} placeholder="Leave blank if unknown" className={input} />
        </label>
        <label className={label}>Issued
          <input type="date" value={form.issued_date || ""} onChange={set("issued_date")} className={input} />
        </label>
        <label className={label}>Expiry
          <input type="date" value={form.expiry_date || ""} onChange={set("expiry_date")} className={input} />
        </label>
        <label className={label}>Status
          <select value={form.status || "Unknown"} onChange={set("status")} className={input}>
            {Object.keys(LICENCE_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
    );
  }

  if (tab === "studios") {
    return (
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className={label}>Studio name
          <input value={form.studio_name || ""} onChange={set("studio_name")} className={input} />
        </label>
        <label className={label}>Physical jurisdiction
          <input value={form.physical_jurisdiction || ""} onChange={set("physical_jurisdiction")} className={input} />
        </label>
        <label className={label}>Location detail
          <input value={form.physical_location_detail || ""} onChange={set("physical_location_detail")} className={input} />
        </label>
        <label className={label}>Destination markets (comma separated)
          <input value={form.destination_markets || ""} onChange={set("destination_markets")} className={input} />
        </label>
        <label className={label}>Premises approval
          <select value={form.premises_approval_status || "Unknown"} onChange={set("premises_approval_status")} className={input}>
            {["Unknown", "Not required", "Applied", "Approved", "Conditional"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
    );
  }

  if (tab === "profiles") {
    return (
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className={label}>Jurisdiction
          <select value={form.jurisdiction_id || ""} onChange={set("jurisdiction_id")} className={input}>
            <option value="">Select…</option>
            {jurisdictionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={label}>Product line
          <select value={form.product_type || "Slot"} onChange={set("product_type")} className={input}>
            {["Slot", "Live Casino Game", "Live Studio Operation"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className={label}>Entity
          <input value={form.legal_entity_name || ""} onChange={set("legal_entity_name")} className={input} />
        </label>
        <label className={label}>Permission status
          <select value={form.permission_status || "Unknown"} onChange={set("permission_status")} className={input}>
            {["Licensed", "Conditionally permitted", "Internal prohibition", "Unknown", "Under review"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>Basis
          <input value={form.basis_notes || ""} onChange={set("basis_notes")} className={input} />
        </label>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      <label className={label}>Legal entity name
        <input value={form.entity_name || ""} onChange={set("entity_name")} className={input} />
      </label>
      <label className={label}>Incorporated in
        <input value={form.jurisdiction_of_incorporation || ""} onChange={set("jurisdiction_of_incorporation")} className={input} />
      </label>
      <label className={label}>Entity role
        <select value={form.entity_role || "Unknown"} onChange={set("entity_role")} className={input}>
          {["Licence holder", "Game supplier", "Studio operator", "Group or support", "Unknown"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className={label}>Product name
        <input value={form.product_name || ""} onChange={set("product_name")} className={input} />
      </label>
      <label className={label}>Product type
        <select value={form.product_type || "Slot"} onChange={set("product_type")} className={input}>
          {["Slot", "Live Casino Game", "Live Studio Operation"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className={label}>Studio
        <input value={form.studio || ""} onChange={set("studio")} className={input} />
      </label>
    </div>
  );
}