import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { callFunction } from '@/lib/audit';
import SectionCard from '@/components/SectionCard';
export default function SourceFormatGaps() {
  const [page,setPage] = useState({items:[]}); const [total,setTotal] = useState(0); const [cursor,setCursor] = useState(''); const [busy,setBusy] = useState(false); const [message,setMessage] = useState('');
  const load = useCallback(async () => {
    const q = {is_fixture:{$ne:true},$or:[{retrieval_result:{$regex:'PDF'}},{format_gap:{$regex:'.+'}},{extraction_status:{$regex:'Failed|Pending.*PDF'}}]};
    const [p,n] = await Promise.all([base44.entities.Source.filter(q,{sort:'jurisdiction_name',limit:15,cursor:cursor || undefined}),base44.entities.Source.count(q)]);setPage(p);setTotal(n);
  },[cursor]);
  useEffect(()=>{load();},[load]);
  const inspect = async id => { setBusy(true); try { const r = await callFunction('sourceReview',{op:'inspect',source_ids:[id]});setMessage(r.results.map(x=>x.error || `${x.extraction}: ${x.limitations}`).join(' '));await load(); } catch(e) {setMessage(e.message);} finally {setBusy(false);} };
  return <SectionCard title={`${total} source-specific format / extraction reviews`} description="PDF is not synonymous with scanned content. OCR and browser-rendering needs remain unconfirmed until the particular document is inspected; no jurisdiction-wide absence is inferred.">
    <div className="divide-y divide-border">{page.items.map(s=><article key={s.id} className="space-y-1 p-3 text-xs"><strong>{s.source_id} · {s.jurisdiction_name} · {s.authority}</strong><a href={s.url} target="_blank" rel="noreferrer" className="block break-all text-accent underline">Original publication</a><p>{s.format_gap || s.extraction_status || 'PDF text extraction is outstanding.'}</p><p className="text-muted-foreground">Official alternatives: {(s.official_alternative_urls || []).join(' · ') || 'No successful official alternative recorded. Advertised text/feed alternatives are tried before treating a JavaScript shell as blocked.'}</p><button type="button" onClick={()=>inspect(s.id)} disabled={busy} className="text-accent underline disabled:opacity-40">Try official alternative / bounded extraction</button></article>)}</div>
    <div className="space-y-2 border-t border-border p-3 text-xs"><p>Built-in AI-assisted PDF extraction is bounded to one document per job and the configured usage allowance, with an 8 MB retrieval cap. Transcription is flagged uncertain; no external paid service is activated. JavaScript-only pages without an official accessible alternative remain source-specific blockers requiring an approved rendering service and credentials; no external price is assumed.</p><p role="status">{busy?'Retrieving original and available official alternative…':message}</p><button type="button" onClick={()=>setCursor('')} className="mr-4 underline">First page</button><button type="button" disabled={!page.has_more} onClick={()=>setCursor(page.next_cursor)} className="underline disabled:opacity-40">Next sources</button></div>
  </SectionCard>;
}