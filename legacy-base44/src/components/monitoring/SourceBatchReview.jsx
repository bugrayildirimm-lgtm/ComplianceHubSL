import SectionCard from '@/components/SectionCard';
import SourceEvidenceCard from '@/components/monitoring/SourceEvidenceCard';
import useSourceReview from '@/components/monitoring/useSourceReview';
import useActor from '@/lib/useActor';
import VerificationReadiness from '@/components/monitoring/VerificationReadiness';
export default function SourceBatchReview({ onChanged }) {
  const r = useSourceReview(onChanged); const actor = useActor();
  return <SectionCard title="Batch source verification" description="Confirm official provenance and actual coverage. HTTP success, domains and AI assertions are not proof. This decision does not approve a legal interpretation.">
    <VerificationReadiness />
    <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 text-xs">
      <strong>{r.page.total} pending candidates</strong><input aria-label="Search candidate sources" placeholder="Search jurisdiction or publisher" value={r.search} onChange={e=>r.setSearch(e.target.value)} className="rounded border border-input bg-background p-2" />
      <button type="button" onClick={r.load} disabled={r.busy} className="underline">Refresh</button>
      <span className="text-muted-foreground">Select only candidates whose evidence has been reviewed. Unclear items remain separate and unselected.</span>
    </div>
    {r.loading ? <p className="p-4 text-sm text-muted-foreground">Loading candidate evidence…</p> : !r.page.items.length ? <p className="p-4 text-sm text-muted-foreground">No candidates match this page.</p> : r.page.items.map(s=><SourceEvidenceCard key={s.id} source={s} selected={r.selected.includes(s.id)} onSelect={()=>r.select(s.id)} review={r.reviews[s.id] || {}} onReview={v=>r.setReviews({...r.reviews,[s.id]:v})} busy={r.busy} onInspect={()=>r.act('inspect',[s.id])} />)}
    <div className="space-y-3 border-t border-border p-4 text-xs">
      <label className="block">Recorded rationale for the selected sources<textarea value={r.rationale} onChange={e=>r.setRationale(e.target.value)} rows={3} maxLength={3000} className="mt-1 w-full rounded border border-input bg-background p-2" placeholder="Identify the official publisher, the provenance references reviewed, territorial scope and actual subjects covered." /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={r.confirmed} onChange={e=>r.setConfirmed(e.target.checked)} />I personally reviewed official provenance references and sample documents for each selected source. Routine monitoring can proceed after verification; legal interpretation is separate.</label>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={r.busy || !actor.canWrite || !r.confirmed || !r.selected.length || r.rationale.trim().length<25} onClick={()=>r.act('verify')} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-40">{r.busy?'Recording…':`Verify ${r.selected.length} selected`}</button>
        <button type="button" disabled={r.busy || !actor.canWrite || !r.selected.length || r.rationale.trim().length<25} onClick={()=>r.act('reject')} className="rounded border border-input px-3 py-2 disabled:opacity-40">Reject selected with rationale</button>
        <button type="button" onClick={r.first} className="underline">First page</button><button type="button" disabled={!r.page.has_more || r.busy} onClick={r.next} className="underline disabled:opacity-40">Next page</button>
      </div>{r.message && <p role="status" className="whitespace-pre-wrap">{r.message}</p>}
    </div>
  </SectionCard>;
}