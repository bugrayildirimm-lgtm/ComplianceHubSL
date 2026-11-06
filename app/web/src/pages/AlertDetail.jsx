import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { logAudit, callFunction } from "@/lib/audit";
import { nextClientRef } from "@/lib/refs";

import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import AlertAssessmentForm from "@/components/radar/AlertAssessmentForm";
import AlertProvenance from "@/components/radar/AlertProvenance";
import { CATEGORIES, PRIORITY_TONE, REVIEW_TONE, STAGE_TONE, fmtDate, fmtDateTime } from "@/lib/format";
import { AlertTriangle, ArrowLeft, ExternalLink, FileText } from "lucide-react";

export default function AlertDetail() {
  const { alertId } = useParams();
  const [alert, setAlert] = useState(null);
  const [actions, setActions] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ category: CATEGORIES[0], regulated_party: "Supplier", article_reference: "", internal_interpretation: "", applicability_rationale: "", source_excerpt: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const record = await base44.entities.RegulatoryAlert.get(alertId).catch(() => null);
    setAlert(record);
    if (record) {
      const [linkedActions, linkedRequirements] = await Promise.all([
        base44.entities.ActionItem.filter({ linked_alert_id: alertId }),
        base44.entities.Requirement.filter({ linked_alert_id: alertId }),
      ]);
      setActions(linkedActions);
      setRequirements(linkedRequirements);
      setDraft((current) => ({ ...current, source_excerpt: current.source_excerpt || (record.source_passages || [])[0] || "" }));
    }
    setLoading(false);
  }, [alertId]);

  useEffect(() => { load(); }, [load]);

  const createAction = async () => {
    setBusy(true);
    setMessage("");
    try {
      const actionRef = await nextClientRef("ActionItem", "action_ref", "ACT", 4);
      const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const action = await base44.entities.ActionItem.create({
        action_ref: actionRef,
        title: `Assess and implement: ${alert.title}`,
        description: `Created from regulatory alert ${alert.alert_ref} (${alert.jurisdiction_name}). Confirm scope, then record implementation evidence.`,
        owner_team: alert.primary_owner_team || "Unassigned",
        owner: "",
        due_date: alert.implementation_deadline || due,
        status: "Open",
        priority: alert.priority === "Unclassified" ? "Medium" : alert.priority,
        affected_scope: (alert.affected_products || []).join(", ") || "To be confirmed",
        jurisdiction_id: alert.jurisdiction_id,
        jurisdiction_name: alert.jurisdiction_name,
        linked_alert_id: alert.id,
        is_fixture: Boolean(alert.is_fixture),
      });
      await base44.entities.RegulatoryAlert.update(alert.id, {
        linked_action_ids: [...(alert.linked_action_ids || []), action.id],
        review_status: "Impact assessment in progress",
      });
      await logAudit({
        eventType: "Implementation action created",
        entityType: "ActionItem",
        entityId: actionRef,
        entityLabel: action.title,
        summary: `Action ${actionRef} created from alert ${alert.alert_ref}.`,
      });
      setMessage(`Action ${actionRef} created.`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const proposeRequirement = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await callFunction("requirementWrite", {
        op: "createCandidate",
        title: alert.title,
        jurisdiction_id: alert.jurisdiction_id,
        jurisdiction_name: alert.jurisdiction_name,
        territorial_scope: "To be confirmed against the instrument",
        category: draft.category,
        product_type: (alert.affected_products || [])[0] || "Unknown",
        regulated_party: draft.regulated_party,
        authority: alert.authority,
        instrument: alert.document_version ? `${alert.title} (${alert.document_version})` : alert.title,
        article_reference: draft.article_reference,
        source_url: alert.document_url,
        source_version: alert.document_version || "",
        source_excerpt: draft.source_excerpt,
        legal_status: alert.legal_stage === "In force" ? "In force" : alert.legal_stage === "Official guidance" ? "Guidance" : "Unknown",
        publication_date: alert.publication_date || "",
        effective_date: alert.effective_date || "",
        internal_interpretation: draft.internal_interpretation,
        applicability_rationale: draft.applicability_rationale,
        responsible_team: alert.primary_owner_team || "Unassigned",
        linked_alert_id: alert.id,
        ai_generated: false,
        is_fixture: Boolean(alert.is_fixture),
      });
      if (result?.error) throw new Error(result.error);
      const requirementId = result.requirement.requirement_id;
      const requirement = result.requirement;
      await base44.entities.RegulatoryAlert.update(alert.id, {
        linked_requirement_ids: [...(alert.linked_requirement_ids || []), requirement.requirement_id],
      });
      await logAudit({
        eventType: "Requirement proposed",
        entityType: "Requirement",
        entityId: requirementId,
        entityLabel: requirement.title,
        summary: `Candidate requirement ${requirementId} proposed from alert ${alert.alert_ref}.`,
      });
      setMessage(`Candidate requirement ${requirementId} created — unreviewed until approved.`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-md bg-slate-100" />;
  if (!alert) {
    return (
      <div className="panel p-6">
        <AlertTriangle className="mb-2 h-5 w-5 text-amber-600" />
        <p className="text-[13px] text-slate-700">This alert no longer exists.</p>
        <Link to="/radar" className="mt-2 inline-block text-[12.5px] font-medium text-green-800">Back to the radar</Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/radar" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-slate-900">
        <ArrowLeft className="h-3.5 w-3.5" /> Regulatory Radar
      </Link>

      <div className="mb-5 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11.5px] text-slate-500">{alert.alert_ref}</span>
          <StatusBadge tone={STAGE_TONE[alert.legal_stage] || "unknown"}>{alert.legal_stage}</StatusBadge>
          <StatusBadge tone={PRIORITY_TONE[alert.priority] || "unknown"} dot={false}>{alert.priority}</StatusBadge>
          <StatusBadge tone={REVIEW_TONE[alert.review_status] || "unknown"} dot={false}>{alert.review_status}</StatusBadge>
          {alert.ai_generated && <StatusBadge tone="neutral" dot={false}>AI draft — unreviewed</StatusBadge>}
          {alert.is_fixture && <StatusBadge tone="warning" dot={false}>Test fixture — not an official publication</StatusBadge>}
          {alert.previously_untracked && <StatusBadge tone="info" dot={false}>Older document found late — baseline material</StatusBadge>}
        </div>
        <h1 className="mt-2 text-[22px] font-semibold leading-snug text-slate-900">{alert.title}</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {alert.jurisdiction_name} · {alert.authority} · detected {fmtDate(alert.detection_date)}
        </p>
      </div>

      {alert.withdrawn && (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="text-[12.5px] leading-relaxed text-red-900">
              <span className="font-semibold">Withdrawn {fmtDateTime(alert.withdrawn_at)}.</span> {alert.withdrawal_reason}
              <span className="mt-1 block text-[11.5px] text-red-800">
                Recorded by {alert.withdrawn_by || "unspecified"}. The original evidence, classifications and audit history are retained unchanged, and this alert is excluded from actionable counts.
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SectionCard title="What changed and why it may matter">
            <div className="space-y-3 px-4 py-3 text-[12.5px] leading-relaxed text-slate-800">
              {alert.summary && <p>{alert.summary}</p>}
              {alert.what_changed && (
                <div>
                  <div className="eyebrow mb-1">What changed</div>
                  <p>{alert.what_changed}</p>
                </div>
              )}
              {alert.why_it_matters && (
                <div>
                  <div className="eyebrow mb-1">Why it may matter</div>
                  <p>{alert.why_it_matters}</p>
                </div>
              )}
              {!alert.summary && !alert.what_changed && (
                <p className="text-slate-500">No narrative prepared. Review the source passages below.</p>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Source evidence"
            description="Original publication, version and the passages relied on. Retrieved content is treated as untrusted data."
            actions={
              alert.document_url && (
                <a href={alert.document_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[12px] font-medium text-green-800 hover:underline">
                  Open original <ExternalLink className="h-3 w-3" />
                </a>
              )
            }
          >
            <div className="divide-y divide-border text-[12.5px]">
              <Row label="Publishing authority" value={alert.authority || "Unknown"} />
              <Row label="Document version" value={alert.document_version || "Version unknown"} />
              <Row label="URL" value={<span className="break-all font-mono text-[11.5px] text-slate-600">{alert.document_url || "—"}</span>} />
              {(alert.source_passages || []).length > 0 ? (
                <div className="px-4 py-3">
                  <div className="eyebrow mb-1.5">Relied-on passages</div>
                  <ul className="space-y-2">
                    {alert.source_passages.map((passage, index) => (
                      <li key={index} className="border-l-2 border-slate-200 pl-3 text-[12px] italic leading-relaxed text-slate-700">
                        “{passage}”
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="px-4 py-3 text-[12px] text-amber-800">
                  No source passage was captured — this alert cannot be approved into a requirement until it is evidenced.
                </div>
              )}
              {(alert.other_sources || []).length > 0 && (
                <div className="px-4 py-3">
                  <div className="eyebrow mb-1">Also reported by</div>
                  <ul className="space-y-1 font-mono text-[11px] text-slate-600">
                    {alert.other_sources.map((url) => <li key={url} className="break-all">{url}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </SectionCard>

          <AlertProvenance alert={alert} onSaved={load} />

          <SectionCard title="Impact assessment" description="Recorded by a person, stored with the assessor and time.">
            <AlertAssessmentForm alert={alert} onSaved={load} />
            {alert.assessment_reason && (
              <div className="border-t border-border bg-slate-50/60 px-4 py-2.5 text-[11.5px] text-slate-700">
                <span className="font-medium">Current outcome: {alert.assessment_outcome}.</span> {alert.assessment_reason}
                <span className="block text-slate-500">Assessed by {alert.assessed_by || "unknown"} · {fmtDateTime(alert.assessed_at)}</span>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Propose a requirement or amendment" description="Only evidenced wording, with a separate internal interpretation.">
            <div className="space-y-2.5 px-4 py-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[11.5px] text-slate-600">
                  Category
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]"
                  >
                    {CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-[11.5px] text-slate-600">
                  Regulated party
                  <select
                    value={draft.regulated_party}
                    onChange={(e) => setDraft({ ...draft, regulated_party: e.target.value })}
                    className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]"
                  >
                    {["Supplier", "Operator", "Studio", "Other", "Unknown"].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-[11.5px] text-slate-600">
                Article, section or paragraph
                <input
                  value={draft.article_reference}
                  onChange={(e) => setDraft({ ...draft, article_reference: e.target.value })}
                  placeholder="e.g. Art. 12(3) — required for approval"
                  className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]"
                />
              </label>
              <label className="block text-[11.5px] text-slate-600">
                Official wording (verbatim excerpt)
                <textarea
                  value={draft.source_excerpt}
                  onChange={(e) => setDraft({ ...draft, source_excerpt: e.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]"
                />
              </label>
              <label className="block text-[11.5px] text-slate-600">
                Internal interpretation (kept separate from official wording)
                <textarea
                  value={draft.internal_interpretation}
                  onChange={(e) => setDraft({ ...draft, internal_interpretation: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]"
                />
              </label>
              <label className="block text-[11.5px] text-slate-600">
                Applicability rationale (why this binds Stakelogic)
                <textarea
                  value={draft.applicability_rationale}
                  onChange={(e) => setDraft({ ...draft, applicability_rationale: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={proposeRequirement}
                  disabled={busy || !draft.article_reference || !draft.source_excerpt || !draft.applicability_rationale}
                  className="rounded-sm bg-green-800 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
                >
                  Create candidate requirement
                </button>
                <button
                  type="button"
                  onClick={createAction}
                  disabled={busy}
                  className="rounded-sm border border-border px-3 py-1.5 text-[12.5px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  Create implementation action
                </button>
                {message && <span className="text-[11.5px] text-slate-600">{message}</span>}
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Legal dates" description="Publication, detection and effect are never conflated.">
            <div className="divide-y divide-border text-[12px]">
              <Row label="Published" value={alert.publication_date ? fmtDate(alert.publication_date) : "Not stated in source"} />
              <Row label="Detected" value={alert.detection_date ? fmtDate(alert.detection_date) : "—"} />
              <Row label="Effective" value={alert.effective_date ? fmtDate(alert.effective_date) : "Not stated in source"} />
              <Row label="Consultation deadline" value={alert.consultation_deadline ? fmtDate(alert.consultation_deadline) : "None stated"} />
              <Row label="Implementation deadline" value={alert.implementation_deadline ? fmtDate(alert.implementation_deadline) : "None stated"} />
              <Row label="Date confidence" value={alert.date_confidence} />
            </div>
          </SectionCard>

          <SectionCard title="Potentially affected">
            <div className="space-y-2.5 px-4 py-3 text-[12px]">
              <Chips label="Products" values={alert.affected_products} />
              <Chips label="Entities" values={alert.affected_entities} />
              <Chips label="Certificates" values={alert.affected_certificates} />
              <Chips label="Studios" values={alert.affected_studios} />
              <Row label="Primary owner" value={alert.primary_owner_team || "Unassigned"} />
              <Row label="Collaborating" value={(alert.collaborating_teams || []).join(", ") || "None recorded"} />
            </div>
          </SectionCard>

          <SectionCard title="Linked records" description={`${requirements.length} requirement(s) · ${actions.length} action(s)`}>
            <div className="divide-y divide-border">
              {requirements.map((req) => (
                <Link key={req.id} to={`/requirements/${req.id}`} className="rowlink block px-4 py-2.5">
                  <div className="font-mono text-[11px] text-slate-500">{req.requirement_id}</div>
                  <div className="text-[12.5px] text-slate-900">{req.title}</div>
                  <div className="text-[11px] text-muted-foreground">{req.approval_status}</div>
                </Link>
              ))}
              {actions.map((action) => (
                <div key={action.id} className="px-4 py-2.5">
                  <div className="font-mono text-[11px] text-slate-500">{action.action_ref}</div>
                  <div className="text-[12.5px] text-slate-900">{action.title}</div>
                  <div className="text-[11px] text-muted-foreground">{action.status} · due {fmtDate(action.due_date)}</div>
                </div>
              ))}
              {!requirements.length && !actions.length && (
                <div className="flex items-start gap-2 px-4 py-3 text-[11.5px] text-slate-600">
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  Nothing linked yet. Record an impact assessment, then propose a requirement or an action.
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right text-slate-800">{value}</span>
    </div>
  );
}

function Chips({ label, values }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      {(values || []).length ? (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <span key={value} className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{value}</span>
          ))}
        </div>
      ) : (
        <span className="text-[11.5px] text-slate-500">Not established</span>
      )}
    </div>
  );
}