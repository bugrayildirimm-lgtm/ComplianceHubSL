import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { callFunction, logAudit } from "@/lib/audit";
import useActor from "@/lib/useActor";
import AcceptanceStatus from '@/components/requirements/AcceptanceStatus';
import AccessAcceptanceSetup from '@/components/assurance/AccessAcceptanceSetup';
import OperationalHandoff from '@/components/assurance/OperationalHandoff';
import PageHeader from "@/components/PageHeader";
import SectionCard from "@/components/SectionCard";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { fmtDateTime } from "@/lib/format";
import { Database, Download, ShieldCheck, Users } from "lucide-react";

const ROLES = ["Administrator", "Regulatory Compliance", "Technical Compliance", "Approver", "Read-only"];
const ROLE_TONE = { Administrator: "neutral", "Regulatory Compliance": "info", "Technical Compliance": "accent", Approver: "success", "Read-only": "unknown" };

export default function Administration() {
  const actor = useActor();
  const [members, setMembers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [config, setConfig] = useState(null);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState({ user_email: "", full_name: "", access_role: "Regulatory Compliance", can_approve: false });
  const [fixtureJurisdiction, setFixtureJurisdiction] = useState("");

  const load = useCallback(async () => {
    const [memberList, auditPage, configs, jPage] = await Promise.all([
      base44.entities.TeamMember.list({ limit: 200 }),
      base44.entities.AuditEvent.list({ sort: "-created_date", limit: 150 }),
      base44.entities.MonitoringConfig.filter({ config_key: "default" }),
      base44.entities.Jurisdiction.list({ sort: "jurisdiction_id", limit: 500 }),
    ]);
    setMembers(memberList.items || []);
    setAudit(auditPage.items || []);
    setConfig((configs || [])[0] || null);
    setJurisdictions(jPage.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveMember = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (!member.user_email) throw new Error("Email is required.");
      const result = await callFunction("teamAuthority", {
        op: "assign",
        user_email: member.user_email,
        full_name: member.full_name,
        access_role: member.access_role,
        active: true,
        reason: `Role administration from the Access roles screen for ${member.user_email}`,
      });
      if (result?.error) throw new Error(result.error);
      setMember({ user_email: "", full_name: "", access_role: "Regulatory Compliance", can_approve: false });
      setMessage(result.member.can_approve ? "Access role recorded; approval authority held." : "Access role recorded without approval authority. Authority must be confirmed by a different authorised person.");
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateMember = async (record, patch) => {
    setMessage("");
    try {
      if (patch.access_role) {
        const result = await callFunction("teamAuthority", { op: "assign", user_email: record.user_email, access_role: patch.access_role, reason: `Access role changed to ${patch.access_role} on the Access roles screen` });
        if (result?.error) throw new Error(result.error);
      } else if (patch.can_approve !== undefined) {
        const result = await callFunction("teamAuthority", { op: patch.can_approve ? "confirmAuthority" : "revokeAuthority", member_id: record.id, reason: `${patch.can_approve ? "Approval authority confirmed" : "Approval authority revoked"} on the Access roles screen` });
        if (result?.error) throw new Error(result.error);
      } else {
        const result = await callFunction("teamAuthority", { op: "assign", user_email: record.user_email, access_role: record.access_role, active: patch.active, reason: `Active flag changed on the Access roles screen` });
        if (result?.error) throw new Error(result.error);
      }
      setMessage("Access change recorded in the audit history.");
      load();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const saveConfig = async (patch) => {
    setBusy(true);
    try {
      if (config) await base44.entities.MonitoringConfig.update(config.id, patch);
      else await base44.entities.MonitoringConfig.create({ config_key: "default", ...patch });
      await logAudit({
        eventType: "Configuration changed",
        entityType: "MonitoringConfig",
        entityLabel: "Monitoring configuration",
        summary: `Updated: ${Object.keys(patch).join(", ")}.`,
      });
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    setBusy(true);
    setMessage("Preparing export…");
    try {
      const names = ["Jurisdiction", "MarketProfile", "MarketPermissionDecision", "LicenceCertificate", "LiveStudio", "LegalEntity", "GameProduct", "Source", "DocumentRecord", "RegulatoryAlert", "Requirement", "RequirementVersion", "ActionItem", "Approval", "AuditEvent"];
      const payload = { exported_at: new Date().toISOString(), entities: {} };
      for (const name of names) {
        const page = await base44.entities[name].list({ limit: 500 });
        payload.entities[name] = page.items || [];
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stakelogic-compliance-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Export downloaded (first 500 records per entity).");
      await logAudit({ eventType: "Data export", entityType: "Export", summary: "Compliance data exported as JSON." });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const createFixture = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await callFunction("createTestFixture", { jurisdiction_id: fixtureJurisdiction });
      if (result?.error) throw new Error(result.error);
      setMessage(`Labelled fixture ${result.alert_ref} created. It is marked as a test fixture and excluded from monitoring claims.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Configuration & assurance"
        title="Administration"
        description="Access roles, monitoring configuration, audit history, export and backup arrangements. Administrator access never grants compliance-approval authority."
      />

      {message && <div className="mb-4 rounded-md border border-border bg-white px-3.5 py-2 text-[12px] text-slate-700">{message}</div>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SectionCard title="Access roles" description="Approval authority is a separate flag, granted deliberately." actions={<span className="text-[11.5px] text-slate-500">{members.length} member(s)</span>}>
            <div className="grid gap-2.5 border-b border-border bg-slate-50/60 px-4 py-3 sm:grid-cols-4">
              <input value={member.user_email} onChange={(e) => setMember({ ...member, user_email: e.target.value })} placeholder="Work email" className="h-8 rounded-sm border border-border px-2 text-[12.5px]" />
              <input value={member.full_name} onChange={(e) => setMember({ ...member, full_name: e.target.value })} placeholder="Full name" className="h-8 rounded-sm border border-border px-2 text-[12.5px]" />
              <select value={member.access_role} onChange={(e) => setMember({ ...member, access_role: e.target.value })} className="h-8 rounded-sm border border-border bg-white px-2 text-[12.5px]">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">No approval authority granted</span>
                <button type="button" onClick={saveMember} disabled={busy} className="rounded-sm bg-green-800 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">Add</button>
              </div>
            </div>
            <DataTable
              loading={loading}
              rows={members}
              columns={[
                { key: "user_email", header: "Member", render: (m) => <div><div className="font-medium text-slate-900">{m.full_name || m.user_email}</div><div className="text-[11px] text-muted-foreground">{m.user_email}</div></div> },
                {
                  key: "access_role",
                  header: "Access role",
                  render: (m) => (
                    <select value={m.access_role} onChange={(e) => updateMember(m, { access_role: e.target.value })} className="h-7 rounded-sm border border-border bg-white px-1.5 text-[11.5px]">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ),
                },
                {
                  key: "can_approve",
                  header: "Approval authority",
                  render: (m) => (
                    <label className="flex items-center gap-1.5 text-[11.5px] text-slate-600">
                      <input type="checkbox" checked={Boolean(m.can_approve)} onChange={(e) => updateMember(m, { can_approve: e.target.checked })} />
                      {m.can_approve ? "Can approve" : "Cannot approve"}
                    </label>
                  ),
                },
                { key: "active", header: "Active", render: (m) => <input type="checkbox" checked={m.active !== false} onChange={(e) => updateMember(m, { active: e.target.checked })} /> },
                {
                  key: "confirmed",
                  header: "Designation by role administrator",
                  render: (m) => (
                    <span className="text-[11px] leading-snug text-slate-600">
                      {m.authority_confirmed_at ? `Confirmed ${fmtDateTime(m.authority_confirmed_at)}` : "Not confirmed — this member cannot approve"}
                    </span>
                  ),
                },
              ]}
              empty={<EmptyState icon={Users} title="No access roles recorded" description="Without a TeamMember record a signed-in person is treated as Read-only. Add the compliance teams here." />}
            />
            <div className="border-t border-border bg-slate-50/60 px-4 py-2.5 text-[11.5px] leading-relaxed text-slate-600">
              Your current role: <span className="font-medium text-slate-900">{actor.loading ? "checking…" : actor.role || "not signed in"}</span>
              {actor.canApprove && " · approval authority enabled"} · Administrator status does not itself allow approvals.
              <p className="mt-2">Native access and open-session revocation acceptance remain pending. A current roster Administrator may deliberately designate a different active registered reviewer; role assignment grants no approval authority. No app-admin bypass or automatic reviewer is used.</p>
            </div>
          </SectionCard>

          <AccessAcceptanceSetup />
          <OperationalHandoff />
          <AcceptanceStatus />
          <SectionCard title="Audit history" description="Server-generated for imports, edits, ownership changes, assessments, approvals and configuration.">
            <DataTable
              loading={loading}
              rows={audit}
              columns={[
                { key: "occurred_at", header: "When", render: (a) => <span className="num text-[11px] text-slate-600">{fmtDateTime(a.occurred_at || a.created_date)}</span> },
                { key: "event_type", header: "Event", render: (a) => <span className="text-[12px] font-medium text-slate-900">{a.event_type}</span> },
                { key: "summary", header: "Summary", render: (a) => <span className="block max-w-[460px] text-[11.5px] leading-snug text-slate-700">{a.summary}</span> },
                { key: "actor", header: "Actor", render: (a) => <span className="text-[11px] text-slate-600">{a.actor_email}<br /><span className="text-slate-400">{a.actor_role}</span></span> },
              ]}
              empty={<EmptyState icon={ShieldCheck} title="No audit events yet" description="Events appear as soon as an import, assessment, ownership change or approval is recorded." />}
            />
            <div className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-slate-600">
              Audit events are written by the server and cannot be edited or deleted by ordinary users. This is an append-only record, not a cryptographic tamper-proof ledger — backups are described below.
            </div>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Monitoring configuration">
            {!config ? (
              <div className="px-4 py-3">
                <p className="mb-2 text-[12px] text-slate-600">No configuration record yet. Create it to control schedules and record which capabilities are configured.</p>
                <button type="button" onClick={() => saveConfig({ monitoring_enabled: true, daily_check_hour_utc: 6, priority_interval_hours: 6, max_sources_per_run: 8, browser_rendering_status: "Not configured", ocr_status: "Not configured", external_notification_status: "Not configured" })} disabled={busy} className="rounded-sm bg-green-800 px-2.5 py-1.5 text-[12px] font-medium text-white">
                  Create configuration
                </button>
              </div>
            ) : (
              <div className="space-y-2 px-4 py-3 text-[12px]">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">Monitoring preference (does not resume workflows)</span>
                  <input type="checkbox" checked={config.monitoring_enabled !== false} onChange={(e) => saveConfig({ monitoring_enabled: e.target.checked })} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">Daily check hour (UTC)</span>
                  <input type="number" min="0" max="23" value={config.daily_check_hour_utc ?? 6} onChange={(e) => saveConfig({ daily_check_hour_utc: Number(e.target.value) })} className="h-7 w-16 rounded-sm border border-border px-1.5 text-[12px]" />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">Priority interval (hours)</span>
                  <input type="number" min="1" max="24" value={config.priority_interval_hours ?? 6} onChange={(e) => saveConfig({ priority_interval_hours: Number(e.target.value) })} className="h-7 w-16 rounded-sm border border-border px-1.5 text-[12px]" />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">Sources per run</span>
                  <input type="number" min="1" max="10" value={config.max_sources_per_run ?? 8} onChange={(e) => saveConfig({ max_sources_per_run: Number(e.target.value) })} className="h-7 w-16 rounded-sm border border-border px-1.5 text-[12px]" />
                </label>
                {[
                  ["browser_rendering_status", "Browser rendering"],
                  ["ocr_status", "PDF text extraction / OCR"],
                  ["external_notification_status", "External notification channel"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-2">
                    <span className="text-slate-700">{label}</span>
                    <select value={config[key] || "Not configured"} onChange={(e) => saveConfig({ [key]: e.target.value })} className="h-7 rounded-sm border border-border bg-white px-1.5 text-[11.5px]">
                      {["Not configured", "Configured", "Configured and tested", "Unavailable", "Failed"].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                ))}
                <div className="border-t border-border pt-2 text-[11px] leading-relaxed text-slate-600">
                  <div>Last run: {config.last_run_at ? fmtDateTime(config.last_run_at) : "none recorded"}</div>
                  {config.last_run_summary && <div className="mt-1 text-slate-500">{config.last_run_summary}</div>}
                </div>
                {!actor.isAppAdmin && (
                  <p className="rounded-sm border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900">
                    Configuration changes are restricted to the app administrator in the dashboard.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Unconfigured capabilities" description="Shown honestly rather than simulated.">
            <ul className="space-y-2 px-4 py-3 text-[11.5px] leading-relaxed text-slate-700">
              {[
                ["Browser rendering", config?.browser_rendering_status, "Needed for JavaScript-only regulator pages. Configure a cloud browser on the Builder plan, then set this to Configured."],
                ["PDF extraction / OCR", config?.ocr_status, "Scanned PDFs are stored by content hash but cannot be text-extracted, so no alert is evidenced from their wording."],
                ["External notifications", config?.external_notification_status, "Urgent alerts are in-app only until an external channel is configured and test-delivered."],
              ].map(([label, status, note]) => (
                <li key={label} className="rounded-sm border border-border px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{label}</span>
                    <StatusBadge tone={status === "Configured and tested" || status === "Configured" ? "success" : "unknown"} dot={false}>{status || "Not configured"}</StatusBadge>
                  </div>
                  <p className="mt-1 text-slate-600">{note}</p>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Export & backup" description="Export is available on demand; backups are taken by the platform.">
            <div className="space-y-2 px-4 py-3 text-[11.5px] leading-relaxed text-slate-700">
              <button type="button" onClick={exportData} disabled={busy} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-800 disabled:opacity-40">
                <Download className="h-3.5 w-3.5" /> Export registers as JSON
              </button>
              <p>
                <span className="font-medium text-slate-900">Backup/restore arrangement:</span> the platform takes automated backups of the app database and provides a restore point from the dashboard. Restoration is an administrator task; the procedure is: export first (above), record the restore point reference, restore, then reconcile audit events against the exported file. Restores are not performed from inside this app.
              </p>
              <p className="text-slate-600">
                Timestamps are stored in UTC and displayed in Europe/Malta by default.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Test fixtures" description="Clearly labelled records used to exercise the evidence chain. Never mixed into monitoring claims.">
            <div className="space-y-2 px-4 py-3">
              <select value={fixtureJurisdiction} onChange={(e) => setFixtureJurisdiction(e.target.value)} className="h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                <option value="">Select a jurisdiction…</option>
                {jurisdictions.map((j) => <option key={j.id} value={j.jurisdiction_id}>{j.name}</option>)}
              </select>
              <button type="button" onClick={createFixture} disabled={busy || !fixtureJurisdiction} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-slate-800 disabled:opacity-40">
                <Database className="h-3.5 w-3.5" /> Create labelled fixture alert
              </button>
              <p className="text-[11px] leading-relaxed text-slate-600">
                The fixture is marked "TEST FIXTURE" throughout and is excluded from coverage statements.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}