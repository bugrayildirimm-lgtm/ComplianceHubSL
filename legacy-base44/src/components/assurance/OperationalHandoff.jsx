import SectionCard from '@/components/SectionCard';
import { workPackageHandoff, assuranceSnapshot as s } from '@/components/assurance/workPackageHandoff';

export default function OperationalHandoff() {
  return <SectionCard title="Three bounded work packages" description="Contained, collection paused, access acceptance pending. Not an operational radar or production-readiness declaration.">
    <div className="space-y-4 p-4 text-xs leading-relaxed">
      <p className="text-muted-foreground">Evidence as of {s.asOf}. No workflows reactivated; no publishing, evidence deletion, paid-service activation or business-data migration performed.</p>
      {workPackageHandoff.map(w => <details key={w.title} className="rounded-md border border-border p-3">
        <summary className="cursor-pointer font-semibold">{w.title}<span className="mt-1 block font-normal text-muted-foreground">{w.status}</span></summary>
        <dl className="mt-3 space-y-3">{[['Mechanism', w.mechanism], ['Evidence', w.evidence], ['Outstanding dependency', w.dependency], ['Next owner action', w.owner]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>
        <h3 className="mt-4 font-semibold">Implementation and acceptance handoff</h3>
        <ol className="mt-2 list-decimal space-y-3 pl-5">{w.specification.map((p,i) => <li key={i}>{p}</li>)}</ol>
      </details>)}
      <details className="rounded-md border border-border p-3"><summary className="cursor-pointer font-semibold">Paused workflows and latest completed security scan</summary>
        <p className="mt-2">Platform inspection returned each workflow below inactive; this is a dated snapshot, not a live scheduler heartbeat.</p>
        <ul className="mt-2 list-disc pl-5">{s.workflows.map(name => <li key={name}>{name}: paused at inspection</li>)}</ul>
        <p className="mt-3">Latest completed scan timestamp: {s.scanAt}</p>
        <dl className="mt-2 space-y-2">{[['Active',s.active],['Acknowledged',s.acknowledged],['Unchecked',s.unchecked],['Dependencies',s.dependencies]].map(([label,value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="mt-3">Owner action: run a fresh Security scan. Do not apply broader suggested read rules automatically or acknowledge risks on the company’s behalf.</p>
      </details>
    </div>
  </SectionCard>;
}