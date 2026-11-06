import { useState } from 'react';
import { callFunction } from '@/lib/audit';
export default function TraversalSettings({ source, onSaved }) {
  const [pages,setPages] = useState(source.pages_per_job || 5);
  const [budget,setBudget] = useState(source.crawl_budget || 500);
  const [depth,setDepth] = useState(source.max_link_depth || 4);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState('');
  const save = async () => { setBusy(true); try { await callFunction('sourceReview',{op:'configure',id:source.id,pages_per_job:pages,crawl_budget:budget,max_link_depth:depth}); setMessage('Saved'); await onSaved(); } catch(e) { setMessage(e.message); } finally { setBusy(false); } };
  return <div className="space-y-1 text-xs">
    <div>{source.crawl_mode || 'Historical collection not started'} · {source.crawl_processed || 0} processed / {source.crawl_pending || 0} pending</div>
    <p className="max-w-xs text-muted-foreground">{source.crawl_stop_reason || 'No completed traversal recorded.'}</p>
    <details><summary className="cursor-pointer text-accent">Traversal limits</summary><div className="space-y-1 pt-2">
      {[['Pages per job',pages,setPages,8],['Cycle budget',budget,setBudget,2000],['Link depth',depth,setDepth,8]].map(([label,value,set,max])=><label key={label} className="flex justify-between gap-2">{label}<input aria-label={label} type="number" min={1} max={max} value={value} onChange={e=>set(Number(e.target.value))} className="w-16 rounded border border-input bg-background p-1" /></label>)}
      <button type="button" onClick={save} disabled={busy} className="underline disabled:opacity-40">Save limits</button><span className="ml-2">{message}</span>
      <p className="text-muted-foreground">Saved frontier: {source.crawl_cycle_id || 'not started'}. {source.crawl_scope || 'Relevant linked publications on the same publisher host.'}</p>
    </div></details>
  </div>;
}