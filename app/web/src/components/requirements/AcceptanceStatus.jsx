import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { callFunction } from '@/lib/audit';
import SectionCard from '@/components/SectionCard';
export default function AcceptanceStatus() {
  const [plan,setPlan] = useState(null); const [fixture,setFixture] = useState(null);
  useEffect(()=>{Promise.all([callFunction('createTestFixture',{op:'acceptancePlan'}),base44.entities.Requirement.filter({is_fixture:true,acceptance_fixture:true},{limit:1})]).then(([p,f])=>{setPlan(p);setFixture((Array.isArray(f) ? f : f.items || [])[0]);});},[]);
  return <SectionCard title="Acceptance evidence & human prerequisites" description={plan?.finding_status || 'Loading prepared acceptance checklist…'}>
    <div className="space-y-3 p-4 text-xs"><p>Unauthenticated and separate ordinary-user probes have not been executed by this builder session. Owner and administrator operation checks do not establish ordinary-user restrictions.</p>
      {fixture && <Link to={`/requirements/${fixture.id}`} className="text-accent underline">Open isolated unapproved acceptance fixture: {fixture.requirement_id}</Link>}
      <p>{plan?.fixture_status}</p>
      <p>Role administration must explicitly designate a different registered user. That person must sign in and record the decision. Administrator status alone grants no compliance-approval authority.</p>
      <details><summary className="cursor-pointer font-medium">Prepared direct-access checklist</summary><ul className="mt-2 space-y-3">{plan?.tests.map(t=><li key={t.name}><strong>{t.name}</strong><p>{t.route}</p><p>Expected: {t.expected}</p><p className="text-muted-foreground">Actual: {t.actual_result}. Stored state: {t.stored_record_state_after_test}.</p></li>)}</ul></details>
      <p>Use the Testing Agent side panel to execute the prepared checklist as signed-out and separate ordinary-user sessions. Match scheduled research to an actual platform workflow run ID; a manual call or trigger label is not sufficient.</p>
    </div>
  </SectionCard>;
}