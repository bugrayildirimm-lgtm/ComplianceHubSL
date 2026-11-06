import { useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import SectionCard from '@/components/SectionCard';

export default function AccessAcceptanceSetup() {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const prepare = async e => {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const { data } = await base44.functions.invoke('accessAcceptance', { op: 'prepare', email, reason, non_editor_confirmation: confirmation });
      setMessage(`${data.fixture.run_id}: prepared only. No access or approval authority granted.`);
    } catch (error) { setMessage(error.response?.data?.error || error.message); }
    finally { setBusy(false); }
  };
  return <SectionCard title="Ordinary-user native access acceptance" description="Preparation only; genuine non-editor execution and independent request-trace review remain pending.">
    <div className="space-y-3 p-4 text-xs">
      <p>Only a current roster Administrator can prepare a separate registered role=User identity with no workspace, collaborator or editor privileges. Platform app-admin status is not permission to prepare or designate authority.</p>
      <p>Direct entity reads use locked admission mirrors, not a fresh roster lookup. Backend permission checks read the roster. This test specifically checks propagation into the same open session.</p>
      <form onSubmit={prepare} className="space-y-2">
        <label className="block">Registered test-user email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded-md border border-input bg-background p-2" /></label>
        <label className="block">Reason for isolated acceptance<input required minLength={10} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded-md border border-input bg-background p-2" /></label>
        <label className="block">IT verification of no workspace/editor privileges<textarea required minLength={20} maxLength={1000} value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1 block w-full rounded-md border border-input bg-background p-2" /></label>
        <button disabled={busy} className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">{busy ? 'Preparing…' : 'Prepare isolated fixture set'}</button>
      </form>
      {message && <p role="status" className="break-words">{message}</p>}
      <Link to="/access-acceptance" className="inline-block text-accent underline">Open the assigned-user acceptance console and retained observations</Link>
      <p>Testing Agent goal: “Using the separately registered ordinary test account, run Not admitted, Admitted read-only, Deactivated and admission-retry checks without closing its session; corroborate every native request and retained before/after state.”</p>
    </div>
  </SectionCard>;
}