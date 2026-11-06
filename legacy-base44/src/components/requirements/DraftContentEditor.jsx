import { useState } from 'react';
import { callFunction } from '@/lib/audit';
const FIELDS = ['title','territorial_scope','legal_entity_name','studio_name','authority','instrument','article_reference','source_url','source_version','source_excerpt','english_translation','internal_interpretation','applicability_rationale','publication_date','effective_date','future_effective_date'];
export default function DraftContentEditor({ requirement, canWrite, onSaved }) {
  const [form,setForm] = useState(Object.fromEntries(FIELDS.map(k=>[k,requirement[k] || ''])));
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState('');
  if (['Approved','Superseded'].includes(requirement.approval_status) || requirement.is_fixture) return null;
  const save = async () => { setBusy(true); try { await callFunction('requirementWrite',{op:'saveDraft',id:requirement.id,...form});setMessage('Draft saved; any previous snapshot must be resubmitted.');await onSaved(); } catch(e) {setMessage(e.message);} finally {setBusy(false);} };
  return <details className="border-t border-border p-4 text-xs"><summary className="cursor-pointer font-medium">Edit draft wording, scope, evidence and dates</summary>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">{FIELDS.map(key=><label key={key} className={/excerpt|interpretation|rationale|translation/.test(key)?'sm:col-span-2 text-muted-foreground':'text-muted-foreground'}>{key.replaceAll('_',' ')}{/excerpt|interpretation|rationale|translation/.test(key)?<textarea rows={3} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} className="mt-1 w-full rounded border border-input bg-background p-2 text-foreground" />:<input type={key.endsWith('_date')?'date':'text'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} className="mt-1 w-full rounded border border-input bg-background p-2 text-foreground" />}</label>)}</div>
    <button type="button" disabled={busy || !canWrite} onClick={save} className="mt-3 rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-40">{busy?'Saving…':'Save draft'}</button><p role="status" className="mt-2">{message}</p>
  </details>;
}