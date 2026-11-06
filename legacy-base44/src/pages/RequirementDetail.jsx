import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { logAudit, callFunction } from "@/lib/audit";
import { nextClientRef } from "@/lib/refs";
import useActor from "@/lib/useActor";
import DraftContentEditor from '@/components/requirements/DraftContentEditor';
import StatusBadge from "@/components/StatusBadge";
import SectionCard from "@/components/SectionCard";
import { APPLICABILITY_TONE, APPROVAL_TONE, IMPLEMENTATION_TONE, fmtDate, fmtDateTime } from "@/lib/format";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export default function RequirementDetail() {
  const { requirementId } = useParams();
  const actor = useActor();
  const [requirement, setRequirement] = useState(null);
  const [versions, setVersions] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [assessment, setAssessment] = useState({ applicability_status: "", implementation_status: "", compliance_assessment: "", next_review_date: "" });

  const load = useCallback(async () => {
    const record = await base44.entities.Requirement.get(requirementId).catch(() => null);
    setRequirement(record);
    if (record) {
      setAssessment({
        applicability_status: record.applicability_status || "Unknown",
        implementation_status: record.implementation_status || "Unknown",
        compliance_assessment: record.compliance_assessment || "",
        next_review_date: record.next_review_date || "",
      });
      const versionPage = await base44.entities.RequirementVersion.filter({ requirement_id: record.requirement_id });
      setVersions((versionPage || []).sort((a, b) => b.version_number - a.version_number));
      if (record.linked_alert_id) {
        const linked = await base44.entities.RegulatoryAlert.get(record.linked_alert_id).catch(() => null);
        setAlert(linked);
      }
    }
    setLoading(false);
  }, [requirementId]);

  useEffect(() => { load(); }, [load]);

  const saveAssessment = async () => {
    setBusy(true);
    setMessage("");
    try {
      const saved = await callFunction("requirementWrite", { op: "saveAssessment", id: requirement.id, ...assessment });
      if (saved?.error) throw new Error(saved.error);
      await logAudit({
        eventType: "Requirement assessment updated",
        entityType: "Requirement",
        entityId: requirement.requirement_id,
        entityLabel: requirement.title,
        summary: `Applicability set to ${assessment.applicability_status}; implementation set to ${assessment.implementation_status}.`,
        detail: assessment.compliance_assessment,
      });
      setMessage("Assessment saved. It is recorded separately from the official wording.");
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const submitForApproval = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await callFunction("submitApproval", {
        item_type: requirement.supersedes_requirement_id ? "Requirement amendment" : "Requirement",
        item_id: requirement.id,
        summary: `${requirement.requirement_id}: ${requirement.title}`,
        designated_reviewer_email: reviewerEmail.trim(),
      });
      if (result?.error) throw new Error(result.error);
      setMessage(`Approval ${result.approval.approval_ref} requested. A different, appointed reviewer must decide.`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const proposeAmendment = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await callFunction("requirementWrite", { op: "amend", id: requirement.id });
      if (result?.error) throw new Error(result.error);
      const newId = result.requirement.requirement_id;
      await logAudit({
        eventType: "Requirement amendment proposed",
        entityType: "Requirement",
        entityId: newId,
        entityLabel: requirement.title,
        summary: `Amendment ${newId} proposed to supersede ${requirement.requirement_id} (version ${(requirement.current_version || 1) + 1}). The approved version is retained unchanged.`,
      });
      setMessage(`Amendment ${newId} created. The approved version ${requirement.requirement_id} remains untouched until the amendment is approved.`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-md bg-slate-100" />;
  if (!requirement) return <p className="p-6 text-[13px]">Requirement not found. <Link to="/requirements" className="text-green-800">Back to the library</Link></p>;

  const isApproved = requirement.approval_status === "Approved";

  return (
    <>
      <Link to="/requirements" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-slate-900">
        <ArrowLeft className="h-3.5 w-3.5" /> Requirements Library
      </Link>

      <div className="mb-5 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11.5px] text-slate-500">{requirement.requirement_id}</span>
          <StatusBadge tone={APPROVAL_TONE[requirement.approval_status] || "unknown"}>{requirement.approval_status}</StatusBadge>
          <StatusBadge tone={APPLICABILITY_TONE[requirement.applicability_status] || "unknown"} dot={false}>Applicability: {requirement.applicability_status}</StatusBadge>
          <StatusBadge tone={IMPLEMENTATION_TONE[requirement.implementation_status] || "unknown"} dot={false}>Implementation: {requirement.implementation_status}</StatusBadge>
          <span className="text-[11px] text-slate-500">Version {requirement.current_version || 1}</span>
        </div>
        <h1 className="mt-2 text-[22px] font-semibold leading-snug text-slate-900">{requirement.title}</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {requirement.jurisdiction_name || "Jurisdiction unknown"} · {requirement.category} · {requirement.regulated_party} · {requirement.obligation_type}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SectionCard title="Official wording" description="Verbatim, with instrument and exact reference. Never paraphrased into the obligation.">
            <div className="divide-y divide-border">
              <div className="px-4 py-3">
                <div className="eyebrow mb-1.5">Source excerpt</div>
                {requirement.source_excerpt ? (
                  <blockquote className="border-l-2 border-slate-300 pl-3 text-[12.5px] italic leading-relaxed text-slate-800">
                    “{requirement.source_excerpt}”
                  </blockquote>
                ) : (
                  <p className="text-[12px] text-amber-800">No excerpt recorded — this cannot be approved until the official wording is evidenced.</p>
                )}
                {requirement.english_translation && (
                  <div className="mt-2 text-[12px] leading-relaxed text-slate-700">
                    <span className="font-medium">Working English translation (machine-assisted, uncertain):</span> {requirement.english_translation}
                  </div>
                )}
              </div>
              <Info label="Authority" value={requirement.authority || "Unknown"} />
              <Info label="Instrument" value={requirement.instrument || "Unknown"} />
              <Info label="Article / section / paragraph" value={requirement.article_reference || "Unknown"} />
              <Info label="Source version" value={requirement.source_version || "Unknown"} />
              <Info label="Language" value={requirement.language || "Unknown"} />
              <Info
                label="Official source"
                value={requirement.source_url
                  ? <a href={requirement.source_url} target="_blank" rel="noreferrer noopener" className="break-all font-mono text-[11.5px] text-green-800 hover:underline">{requirement.source_url}</a>
                  : "Not recorded"}
              />
              <Info label="Obligation type" value={requirement.obligation_type || "Unknown"} />
              <Info label="Legal status" value={requirement.legal_status || "Unknown"} />
              <Info label="Source status when researched" value={requirement.source_verification_status || 'Not recorded; human evidence review required'} />
              </div>
              <DraftContentEditor key={requirement.id} requirement={requirement} canWrite={actor.canWrite} onSaved={load} />
              </SectionCard>

          <SectionCard title="Internal interpretation" description="Separate from the official wording and never presented as the legal text.">
            <div className="space-y-3 px-4 py-3 text-[12.5px] leading-relaxed text-slate-800">
              <div>
                <div className="eyebrow mb-1">Interpretation</div>
                <p>{requirement.internal_interpretation || <span className="text-slate-500">Not recorded.</span>}</p>
              </div>
              <div>
                <div className="eyebrow mb-1">Applicability rationale</div>
                <p>{requirement.applicability_rationale || <span className="text-slate-500">Not recorded.</span>}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="eyebrow mb-1">Operator obligation</div>
                  <p>{requirement.operator_obligation ? "Recorded as an operator obligation — not automatically a supplier obligation." : "Not recorded as an operator obligation."}</p>
                </div>
                <div>
                  <div className="eyebrow mb-1">Supplier support obligation</div>
                  <p>{requirement.supplier_support_obligation ? requirement.support_basis || "Recorded, basis missing." : "None recorded."}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Compliance assessment" description="Recorded by a person. Missing evidence is never shown as compliant.">
            <div className="grid gap-2.5 px-4 py-3 sm:grid-cols-2">
              <label className="text-[11.5px] text-slate-600">
                Applicability
                <select value={assessment.applicability_status} onChange={(e) => setAssessment({ ...assessment, applicability_status: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                  {Object.keys(APPLICABILITY_TONE).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-[11.5px] text-slate-600">
                Implementation
                <select value={assessment.implementation_status} onChange={(e) => setAssessment({ ...assessment, implementation_status: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
                  {Object.keys(IMPLEMENTATION_TONE).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-[11.5px] text-slate-600 sm:col-span-2">
                Assessment and gap notes
                <textarea value={assessment.compliance_assessment} onChange={(e) => setAssessment({ ...assessment, compliance_assessment: e.target.value })} rows={3} className="mt-1 w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]" />
              </label>
              <label className="text-[11.5px] text-slate-600">
                Next review date
                <input type="date" value={assessment.next_review_date} onChange={(e) => setAssessment({ ...assessment, next_review_date: e.target.value })} className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
              </label>
              <div className="flex items-end gap-2">
                <button type="button" onClick={saveAssessment} disabled={busy || !actor.canWrite} className="rounded-sm bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                  Save assessment
                </button>
              </div>
              {message && <p className="text-[11.5px] text-slate-600 sm:col-span-2">{message}</p>}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Approval" description="A designated reviewer other than the drafter decides.">
            <div className="space-y-2.5 px-4 py-3 text-[12px]">
              <Info label="Approved by" value={requirement.approved_by || "Not approved"} />
              <Info label="Approval date" value={requirement.approval_date ? fmtDateTime(requirement.approval_date) : "—"} />
              <Info label="Effective" value={fmtDate(requirement.future_effective_date || requirement.effective_date)} />
              <Info label="Responsible team" value={requirement.responsible_team || "Unassigned"} />
              <Info label="Owner" value={requirement.owner || "Unassigned"} />
              {alert && (
                <div className="pt-1">
                  <div className="eyebrow mb-1">Linked alert</div>
                  <Link to={`/radar/${alert.id}`} className="text-[12px] font-medium text-green-800 hover:underline">{alert.title}</Link>
                </div>
              )}
              {!isApproved && <label className="block text-xs text-muted-foreground">Named reviewer email
                <input type="email" value={reviewerEmail} onChange={e => setReviewerEmail(e.target.value)} className="mt-1 w-full rounded border border-input bg-background p-2 text-foreground" placeholder="Appointed reviewer, different from the drafter" />
              </label>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={submitForApproval}
                  disabled={busy || !actor.canWrite || isApproved}
                  className="rounded-sm bg-green-800 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
                  title={isApproved ? "Approved requirements are never overwritten — propose an amendment" : undefined}
                >
                  Submit for approval
                </button>
                <button
                  type="button"
                  onClick={proposeAmendment}
                  disabled={busy || !actor.canWrite}
                  className="rounded-sm border border-border px-3 py-1.5 text-[12.5px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  Propose amendment
                </button>
              </div>
              {isApproved && (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-600">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  This approved version is locked. Amendments create a new version; the approved text and its approval are retained.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Version history" description={`${versions.length} approved snapshot(s)`}>
            {versions.length === 0 ? (
              <p className="px-4 py-3 text-[11.5px] text-slate-600">No approved version yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {versions.map((version) => (
                  <li key={version.id} className="px-4 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900">Version {version.version_number}</span>
                      <StatusBadge tone="success" dot={false}>{version.approval_status}</StatusBadge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {version.approved_by} · {fmtDateTime(version.approval_date)}
                    </div>
                    {version.change_summary && <div className="mt-0.5 text-[11px] text-slate-600">{version.change_summary}</div>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Dates">
            <div className="divide-y divide-border text-[12px]">
              <Info label="Published" value={fmtDate(requirement.publication_date)} />
              <Info label="Effective" value={fmtDate(requirement.effective_date)} />
              <Info label="Future effective" value={fmtDate(requirement.future_effective_date)} />
              <Info label="Next review" value={fmtDate(requirement.next_review_date)} />
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function Info({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-1.5">
      <span className="shrink-0 text-[11.5px] text-muted-foreground">{label}</span>
      <span className="text-right text-[12px] text-slate-800">{value}</span>
    </div>
  );
}