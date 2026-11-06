import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import AccessAcceptanceEvidence from '@/components/assurance/AccessAcceptanceEvidence';
import { runAccessProbes } from '@/components/assurance/accessProbes';

export default function AccessAcceptance() {
  const [page, setPage] = useState(null); const [items, setItems] = useState([]); const [selected, setSelected] = useState('');
  const [evidence, setEvidence] = useState([]); const [continuation, setContinuation] = useState(null);
  const [stage, setStage] = useState('Not admitted'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const call = async payload => (await base44.functions.invoke('accessAcceptance', payload)).data;
  const reportError = e => setMessage(e.response?.data?.error || e.message);
  const load = async cursor => { const p = await call({ op: 'list', ...(cursor ? { cursor } : {}) }); setPage(p); setItems(v => cursor ? [...v, ...p.items] : p.items); };
  const loadEvidence = async cursor => { const p = await call({ op: 'evidence', manifest_id: selected, ...(cursor ? { cursor } : {}) }); setEvidence(v => cursor ? [...v, ...p.items] : p.items); setContinuation(p.has_more ? p.next_cursor : null); };
  useEffect(() => { load().catch(reportError); }, []);
  useEffect(() => { setEvidence([]); setContinuation(null); if (selected) loadEvidence().catch(reportError); }, [selected]);
  const run = async group => {
    setBusy(true); setMessage('');
    try {
      const context = await call({ op: 'begin', manifest_id: selected, stage, probe_group: group });
      const results = await runAccessProbes(context);
      const result = await call({ op: 'finish', observation_id: context.observation_id, results });
      setMessage(`${context.observation_id}: ${result.status} Session: ${context.session_continuity}`); await loadEvidence();
    } catch (e) { reportError(e); }
    finally { setBusy(false); }
  };
  return <main className="mx-auto min-h-screen max-w-5xl space-y-5 bg-background p-6 text-foreground">
    <header><h1 className="text-xl font-semibold">Isolated ordinary-user access acceptance</h1><p className="mt-2 text-sm text-muted-foreground">This diagnostic is available to its assigned signed-in subject even when not admitted. It does not open any business-data screen or grant a role.</p></header>
    {message && <p role="status" className="rounded-md border border-border p-3 text-sm">{message}</p>}
    {!page ? <p>Loading acceptance prerequisites…</p> : <>
      <div className="rounded-md border border-border bg-card p-4 text-xs"><p>Authenticated: {page.identity.email} · App role: {page.identity.role} · Collaborator claim: {page.identity.collaborator_role || 'none returned'} · Roster: {page.identity.roster_role} · Admission: {String(page.identity.admitted)}</p><p className="mt-2">{page.identity.non_editor_limit}</p><p className="mt-2">{!page.ordinary_candidate && 'This identity cannot provide ordinary-user proof. '}{page.can_prepare ? <Link to="/administration" className="text-accent underline">Prepare fixtures in Administration</Link> : 'A current roster Administrator must prepare the separate ordinary identity; app-admin status alone is insufficient.'}</p></div>
      <label className="block text-sm">Prepared fixture set<select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)} className="mt-1 block w-full rounded-md border border-input bg-card p-2"><option value="">Select a fixture set</option>{items.map(r => <option key={r.id} value={r.id}>{r.run_id} · {r.test_user_email}</option>)}</select></label>
      {!items.length && <p className="text-sm text-muted-foreground">No assigned fixture set. Real non-editor acceptance is pending, not passed.</p>}
      {page.has_more && <button disabled={busy} onClick={() => load(page.next_cursor).catch(reportError)} className="text-sm text-accent underline">Load more fixture sets</button>}
      <section className="space-y-3 rounded-md border border-border p-4 text-sm"><h2 className="font-semibold">Keep this browser session open through all stages</h2><p>A separate authorised roster Administrator admits the subject as Read-only, then deactivates the same roster slot in another session. Do not reload, sign in again or request admission before the initial deactivation probes.</p><p className="text-muted-foreground">Expected native requirement visibility: denied → allowed → denied. Audit canary stays restricted throughout. Protected profile writes and self-authority attempts must fail. An empty filtered read is a denial only because the server confirms that the isolated canary still exists.</p><select value={stage} disabled={busy} onChange={e => setStage(e.target.value)} className="rounded-md border border-input bg-card p-2">{['Not admitted', 'Admitted read-only', 'Deactivated'].map(s => <option key={s}>{s}</option>)}</select><div className="flex flex-wrap gap-3"><button onClick={() => run('Native probes')} disabled={busy || !selected || !page.ordinary_candidate} className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">{busy ? 'Recording native requests…' : 'Run this stage’s native probes'}</button><button onClick={() => run('Admission retry')} disabled={busy || !selected || !page.ordinary_candidate || stage !== 'Deactivated'} className="rounded-md border border-input px-3 py-2 disabled:opacity-50">Then attempt admission retry</button><button disabled={busy || !selected} onClick={() => loadEvidence().catch(reportError)} className="text-accent underline">Refresh evidence only</button></div><p className="text-xs text-muted-foreground">Admission retry is separate so it cannot erase the stored-state evidence of profile/roster tampering attempts. Unexpected stored changes stop further acceptance; no automatic cleanup deletes evidence. Browser responses require independent trace review, not an automatic pass.</p></section>
    </>}
    <AccessAcceptanceEvidence observations={evidence} />
    {continuation && <button disabled={busy} onClick={() => loadEvidence(continuation).catch(reportError)} className="text-sm text-accent underline">Load more observations</button>}
    <footer className="text-xs text-muted-foreground">Use the Testing Agent with the verified ordinary identity to execute these stages and corroborate native HTTP results. Unit checks and editor sessions do not substitute.</footer>
  </main>;
}