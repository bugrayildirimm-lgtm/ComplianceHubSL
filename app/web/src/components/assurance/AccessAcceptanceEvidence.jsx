export default function AccessAcceptanceEvidence({ observations }) {
  return <section className="space-y-3">
    <h2 className="font-semibold">Retained observations</h2>
    {!observations.length && <p className="text-sm text-muted-foreground">No observations loaded. Prepared fixtures and unit checks are not a passed native-access test.</p>}
    {observations.map(o => <details key={o.id} className="rounded-md border border-border bg-card p-3 text-xs">
      <summary className="cursor-pointer font-medium">{o.stage} · {o.probe_group || 'Native probes'} · {o.state} · {o.started_at}</summary>
      <p className="mt-2 break-all">Observation: {o.id} · Run: {o.run_id}</p>
      <p className="mt-2">{o.evidence_class}</p>
      {o.stop_required && <p role="alert" className="mt-2 font-semibold text-destructive">Unexpected stored state change. Stop tests; IT must quarantine the isolated identity and review evidence.</p>}
      {[['Authenticated identity and current permissions', o.identity_json], ['Server-observed state before native requests', o.before_json], ['Client-observed request outcomes, independently corroborate', o.request_results_json], ['Server-observed resulting stored state', o.after_json]].map(([label, value]) => <div key={label} className="mt-3"><h3 className="font-semibold">{label}</h3><pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2">{value ? JSON.stringify(JSON.parse(value), null, 2) : 'Not recorded; no pass claimed'}</pre></div>)}
    </details>)}
  </section>;
}