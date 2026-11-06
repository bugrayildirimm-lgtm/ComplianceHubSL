import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import SectionCard from "@/components/SectionCard";
import StatusBadge from "@/components/StatusBadge";
import SearchLeadList from "@/components/discovery/SearchLeadList";
import { Search } from "lucide-react";

const ORIGIN = "Search-based discovery (unverified lead)";

export default function SearchBasedDiscovery() {
  const [jurisdictions, setJurisdictions] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [jurisdictionId, setJurisdictionId] = useState("");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [jPage, leadPage] = await Promise.all([
      base44.entities.Jurisdiction.list({ sort: "name", limit: 500 }),
      base44.entities.DiscoveryAttempt.filter({ origin: ORIGIN }, { sort: "-attempted_at", limit: 25 }),
    ]);
    setJurisdictions(jPage.items || []);
    setLedger(leadPage.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!jurisdictionId) { setMessage("Choose a jurisdiction first."); return; }
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const response = await base44.functions.invoke("searchDiscovery", { jurisdiction_id: jurisdictionId, topic: topic || undefined });
      const data = response?.data || {};
      if (data.error) throw new Error(data.error);
      setResult(data);
      setMessage(data.skipped
        ? `Search not run: ${data.reason}`
        : `${data.leads_recorded} lead(s) recorded for ${data.jurisdiction}; ${data.duplicates_skipped} already known.`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const rows = (result?.leads || []).map((lead) => ({
    id: lead.url,
    url: lead.url,
    title: lead.title,
    publication_date: lead.publication_date,
    note: lead.snippet,
    duplicate_note: lead.duplicate_note,
  }));

  return (
    <div className="space-y-5">
      <SectionCard
        title="Search-based discovery"
        description="One bounded search per run using Base44's built-in web-search integration. Leads only: no document is retrieved, no publisher is verified, no change is detected and nothing is approved."
        actions={<StatusBadge tone="warning" dot={false}>Search-based discovery</StatusBadge>}
      >
        <div className="grid gap-2.5 px-4 py-3 sm:grid-cols-3">
          <label className="text-[11.5px] text-slate-600">Jurisdiction
            <select value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)} className="mt-1 h-8 w-full rounded-sm border border-border bg-white px-2 text-[12.5px]">
              <option value="">Select…</option>
              {jurisdictions.map((j) => <option key={j.id} value={j.jurisdiction_id}>{j.name}</option>)}
            </select>
          </label>
          <label className="text-[11.5px] text-slate-600 sm:col-span-2">Topic
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. technical standards and game testing requirements" className="mt-1 h-8 w-full rounded-sm border border-border px-2 text-[12.5px]" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          <button type="button" onClick={run} disabled={busy || !jurisdictionId} className="inline-flex items-center gap-2 rounded-sm bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
            <Search className="h-3.5 w-3.5" /> {busy ? "Searching…" : "Run search"}
          </button>
          <span className="text-[11px] text-muted-foreground">Uses one integration credit per run from the app-side allowance.</span>
          {message && <span className="text-[11.5px] text-slate-700">{message}</span>}
        </div>
        {result && !result.skipped && (
          <div className="border-t border-border bg-slate-50/60 px-4 py-2.5 text-[11.5px] leading-relaxed text-slate-700">
            <div className="font-medium text-slate-900">{result.limitation}</div>
            <div className="mt-1 text-muted-foreground">
              Items returned: {result.items_returned} · recorded {result.leads_recorded} · already known {result.duplicates_skipped} · without a usable URL {result.items_without_url} · run {result.run_ref}
            </div>
          </div>
        )}
      </SectionCard>

      <SearchLeadList
        rows={rows}
        loading={false}
        title="Leads from this run"
        description="Model-written titles, URLs, dates and snippets. A URL here is not proof that anything was retrieved."
      />

      <SearchLeadList
        rows={ledger.map((lead) => ({
          id: lead.id,
          url: lead.url,
          title: lead.jurisdiction_name,
          note: lead.detail,
          publication_date: lead.attempted_at ? lead.attempted_at.slice(0, 10) : "",
        }))}
        loading={loading}
        title="Search-based lead ledger"
        description="Every search-based lead is kept with the run that produced it. None of these is a monitored source."
      />
    </div>
  );
}