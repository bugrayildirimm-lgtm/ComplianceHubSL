import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { logAudit } from "@/lib/audit";
import StatusBadge from "@/components/StatusBadge";
import { OWNERSHIP_TONE } from "@/lib/format";

const TEAMS = ["Regulatory Compliance", "Technical Compliance", "Unassigned"];

export default function OwnershipEditor({ jurisdiction, onSaved }) {
  const [team, setTeam] = useState(jurisdiction.primary_owner_team || "Unassigned");
  const [ownerUser, setOwnerUser] = useState(jurisdiction.primary_owner_user || "");
  const [collaborating, setCollaborating] = useState(jurisdiction.collaborating_teams || []);
  const [note, setNote] = useState(jurisdiction.review_notes || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const toggleTeam = (value) => {
    setCollaborating((current) => (current.includes(value) ? current.filter((t) => t !== value) : [...current, value]));
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    const assigned = team !== "Unassigned";
    try {
      await base44.entities.Jurisdiction.update(jurisdiction.id, {
        primary_owner_team: team,
        primary_owner_user: assigned ? ownerUser.trim() : "",
        collaborating_teams: collaborating,
        ownership_status: assigned ? "Assigned" : "Ownership review",
        review_notes: note,
      });
      await logAudit({
        eventType: "Ownership changed",
        entityType: "Jurisdiction",
        entityId: jurisdiction.jurisdiction_id,
        entityLabel: jurisdiction.name,
        summary: `Owner set to ${team}${ownerUser ? ` (${ownerUser})` : ""}; collaborators: ${collaborating.join(", ") || "none"}.`,
      });
      setMessage("Ownership recorded and audited.");
      onSaved?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11.5px] text-slate-600" htmlFor="owner-team">Accountable team</label>
        <select
          id="owner-team"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="h-8 rounded-sm border border-border bg-white px-2 text-[12.5px]"
        >
          {TEAMS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <StatusBadge tone={OWNERSHIP_TONE[assignedTone(team)] || "unknown"}>{assignedTone(team)}</StatusBadge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11.5px] text-slate-600" htmlFor="owner-user">Primary owner</label>
        <input
          id="owner-user"
          value={ownerUser}
          onChange={(e) => setOwnerUser(e.target.value)}
          placeholder="Named accountable person (required when assigned)"
          className="h-8 min-w-[240px] flex-1 rounded-sm border border-border px-2 text-[12.5px]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11.5px] text-slate-600">Collaborating teams</span>
        {["Regulatory Compliance", "Technical Compliance"].map((value) => (
          <label key={value} className="flex items-center gap-1.5 text-[12px] text-slate-700">
            <input type="checkbox" checked={collaborating.includes(value)} onChange={() => toggleTeam(value)} />
            {value}
          </label>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Ownership rationale (why this team, and what still needs confirming)"
        className="w-full rounded-sm border border-border px-2 py-1.5 text-[12.5px]"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-sm bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save ownership"}
        </button>
        <span className="text-[11.5px] text-slate-500">
          Department-level accountability. A named individual is optional and is not appointed by this save.
        </span>
        {message && <span className="text-[11.5px] text-slate-600">{message}</span>}
      </div>
    </div>
  );
}

function assignedTone(team) {
  return team === "Unassigned" ? "Ownership review" : "Assigned";
}