import { useCallback, useEffect, useState } from 'react';
import { callFunction } from '@/lib/audit';
export default function useSourceReview(onChanged) {
  const [page,setPage] = useState({ items: [], total: 0 });
  const [cursor,setCursor] = useState(''); const [search,setSearch] = useState('');
  const [selected,setSelected] = useState([]); const [reviews,setReviews] = useState({});
  const [rationale,setRationale] = useState(''); const [confirmed,setConfirmed] = useState(false);
  const [busy,setBusy] = useState(false); const [loading,setLoading] = useState(true); const [message,setMessage] = useState('');
  const load = useCallback(async () => { setLoading(true); try { const p = await callFunction('sourceReview',{op:'list',cursor,search}); setPage(p); } catch(e) { setMessage(e.message); } finally { setLoading(false); } },[cursor,search]);
  useEffect(() => { const t = setTimeout(load,250); return () => clearTimeout(t); },[load]);
  const act = async (op, ids = selected) => {
    setBusy(true); setMessage('');
    try {
      const r = await callFunction('sourceReview',{op,source_ids:ids,evidence:rationale,provenance_confirmed:confirmed,reviews:ids.map(id=>({id,...reviews[id]}))});
      setMessage(op === 'inspect' ? r.results.map(x=>x.error || `Extraction ${x.extraction}. ${x.limitations || ''}`).join(' ') : `${r.decided.length} decisions recorded; ${r.refused.length} refused. ${r.refused.map(x=>x.reason).join(' ')}`);
      if (op !== 'inspect') { setSelected([]); setConfirmed(false); await onChanged?.(); }
      await load();
    } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const select = id => setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
  return { page, search, setSearch:v=>{setCursor('');setSearch(v);setSelected([]);}, selected, select, reviews, setReviews, rationale, setRationale, confirmed, setConfirmed, busy, loading, message, act, next:()=>{setCursor(page.next_cursor);setSelected([]);}, first:()=>{setCursor('');setSelected([]);}, load };
}