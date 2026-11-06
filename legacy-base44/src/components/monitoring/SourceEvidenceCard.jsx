export default function SourceEvidenceCard({ source: s, selected, onSelect, review, onReview, onInspect, busy }) {
  return <article className="space-y-3 border-b border-border p-4 text-xs">
    <div className="flex items-start gap-3"><input aria-label={`Select ${s.authority}`} type="checkbox" checked={selected} onChange={onSelect} /><div className="min-w-0 flex-1">
      <h3 className="font-semibold text-foreground">{s.authority} · {s.jurisdiction_name}</h3>
      <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-accent underline">Publication page: {s.url}</a>
      <p className="mt-1 text-muted-foreground">{s.territorial_scope || 'Territorial scope not evidenced'} · {s.source_type} · {s.language}</p>
    </div><button type="button" disabled={busy} onClick={onInspect} className="rounded border border-input px-2 py-1 disabled:opacity-40">Retrieve sample</button></div>
    <div className="grid gap-3 md:grid-cols-2">
      <div><h4 className="font-medium">Publisher evidence, requiring human assessment</h4><p className="whitespace-pre-wrap text-muted-foreground">{s.publisher_evidence || 'No official provenance evidence recorded.'}</p><p className="mt-1 text-muted-foreground">{s.verification_evidence}</p></div>
      <div><h4 className="font-medium">Subjects & publication types</h4><p>{(s.subject_coverage?.length ? s.subject_coverage : s.topics || []).join(' · ') || 'Coverage not stated'}</p><p>{(s.publication_types || [s.source_type]).join(' · ')}</p><p className="mt-1 text-muted-foreground">Retrieval: {s.retrieval_result || 'Not yet tested'}. Extraction: {s.extraction_status || 'Unknown'}.</p><p className="text-muted-foreground">{s.coverage_gaps || s.failure_reason || 'No completeness claim.'}</p></div>
    </div>
    {!!s.conflicts?.length && <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">Needs individual attention: {s.conflicts.join(' ')}</div>}
    <div className="grid gap-2 md:grid-cols-3">
      {[['provenance_reference_url','Official provenance reference'],['territorial_scope','Confirmed territorial scope'],['sample_document_url','Underlying document URL']].map(([key,label]) => <label key={key} className="text-muted-foreground">{label}<input value={review[key] ?? s[key] ?? ''} onChange={e => onReview({ ...review, [key]: e.target.value })} className="mt-1 w-full rounded border border-input bg-background p-2 text-foreground" /></label>)}
    </div>
    {(review.sample_document_url || s.sample_document_url) && <a href={review.sample_document_url || s.sample_document_url} target="_blank" rel="noreferrer" className="inline-block text-accent underline">Open underlying document</a>}
  </article>;
}