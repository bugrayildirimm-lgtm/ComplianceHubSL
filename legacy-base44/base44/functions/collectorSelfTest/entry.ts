import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, sha256, json } from '../../shared/compliance.ts';
import { collectTraversal } from '../../shared/collectionTraversal.ts';
import { classifyVersion, publicationLinks } from '../../shared/publicationTraversal.ts';

// The Testing Agent can invoke this harness. Retrieval is in-memory, not live.
// It runs the production traversal/checkpoint engine and labels all data fixtures.
export default async function(req) {
  const base44 = createClientFromRequest(req);
  try {
    const actor = await resolveActor(base44);
    if (!actor.user) return json({error:'Sign-in required'},401);
    if (!actor.canWrite) return json({error:'Read-only access'},403);
    const body = await req.json().catch(()=>({}));
    if (body.op === 'plan') return json({status:'Prepared, not executed',scope:'Isolated engine fixtures, not live retrieval or ordinary-user permission proof',checks:['Saved position across one-page jobs','Pagination discovery through the production link parser','Duplicate links and unchanged version prevention','Historical inventory, not new-change alerts','Known older URL revisited after removal from listing, including same-URL replacement']});
    if (body.op !== 'run') return json({error:'Explicit op=run is required for the isolated fixture harness.'},400);
    const E = base44.asServiceRole.entities;
    const runRef = `FIXTURE-${crypto.randomUUID()}`; const started = new Date().toISOString();
    const root = `https://fixture.invalid/${runRef}/publications`;
    const source = await E.Source.create({source_id:runRef,url:root,authority:'TEST FIXTURE, not an official publisher',jurisdiction_id:'TEST-FIXTURE',jurisdiction_name:'TEST FIXTURE',source_type:'Other official',verification_status:'Verified',check_frequency:'Manual',is_fixture:true,pages_per_job:1,crawl_budget:30,max_link_depth:5,notes:'Synthetic fixture only; excluded from verification and coverage claims.'});
    let version = 1;
    const load = async (_client,url) => {
      let html;
      if (url===root) html = version===1 ? `<a rel="next" href="${root}?page=2">Next</a><a href="${root}/document-a">Document A</a><a href="${root}/document-a">Duplicate document A</a>` : `<a rel="next" href="${root}?page=2">Next</a>`;
      else if (url===`${root}?page=2`) html = `<a href="${root}/document-b">Document B</a>`;
      else html = url.endsWith('/document-a') ? `TEST FIXTURE document A version ${version}. Synthetic supplier evidence, not a legal publication.` : 'TEST FIXTURE document B, stable synthetic text, not a legal publication.';
      return {text:html,html,title:'TEST FIXTURE',hash:await sha256(html),status:200,size:html.length,extraction:'Complete',note:'Synthetic in-memory fixture retrieval',uncertainty:false,links:publicationLinks(html,url,source)};
    };
    const store = async (c,mode) => {
      const page=await E.DocumentRecord.filter({source_id:runRef,document_url:c.url},{sort:'-created_date',limit:1});const prior=page.items[0];
      const change=classifyVersion(prior,c.hash);if(change==='Unchanged')return prior.id;
      const d=await E.DocumentRecord.create({document_ref:`TEST-DOC-${crypto.randomUUID()}`,source_id:runRef,document_url:c.url,title:'TEST FIXTURE',content_hash:c.hash,excerpt:c.text,change_type:change,previous_version_id:prior?.id || '',fetched_at:new Date().toISOString(),extraction_status:'Complete',collection_mode:mode,analysis_state:mode==='Historical'?'Historical inventory':'Pending',is_fixture:true});return d.id;
    };
    const first=await collectTraversal(base44,source,store,load);
    const steps=[{name:'Saved continuation after one page',expected:'Historical partial coverage, pending links and saved cycle',actual:first,passed:first.mode==='Historical' && first.partial && first.pending>0}];
    const drain=async()=>{for(let i=0;i<12;i++){const s=await E.Source.get(source.id);if(!s.crawl_active)return;await collectTraversal(base44,s,store,load);}throw new Error('Fixture failed to drain within bounded attempts');};
    await drain();
    const firstCount=await E.DocumentRecord.count({source_id:runRef});
    const links=await E.CrawlLink.filter({source_id:runRef,cycle_id:first.cycle},{limit:50});
    steps.push({name:'Pagination and duplicate link prevention',expected:4,actual:links.items.length,passed:links.items.length===4});
    version=2;await collectTraversal(base44,await E.Source.get(source.id),store,load);await drain();
    const replacements=await E.DocumentRecord.filter({source_id:runRef,document_url:`${root}/document-a`,change_type:'Replaced at same URL'},{limit:5});
    steps.push({name:'Older known document changed at the same URL after removal from listing',expected:'One replacement with previous version retained',actual:replacements.items.map(d=>({id:d.id,previous_version_id:d.previous_version_id})),passed:replacements.items.length===1 && Boolean(replacements.items[0].previous_version_id)});
    const secondCount=await E.DocumentRecord.count({source_id:runRef});
    await collectTraversal(base44,await E.Source.get(source.id),store,load);await drain();
    const thirdCount=await E.DocumentRecord.count({source_id:runRef});
    steps.push({name:'Unchanged repeat creates no versions',expected:secondCount,actual:thirdCount,passed:secondCount===thirdCount});
    const historical=await E.DocumentRecord.count({source_id:runRef,collection_mode:'Historical',analysis_state:'Pending'});
    steps.push({name:'Historical inventory is not queued as new-change analysis',expected:0,actual:historical,passed:historical===0});
    const run=await E.DiscoveryRun.create({run_ref:runRef,run_kind:'Collector self-test',trigger_type:'Manual',status:steps.every(s=>s.passed)?'Completed':'Failed',processed:steps.length,llm_calls:0,credits_estimated:0,started_at:started,finished_at:new Date().toISOString(),notes:'In-memory production-engine fixtures only. Not live collection, legal evidence or ordinary-user security acceptance.'});
    await logAudit(base44,actor,{event_type:'Collector fixture acceptance',entity_type:'DiscoveryRun',entity_id:run.id,summary:`${runRef}: ${steps.filter(s=>s.passed).length}/${steps.length} isolated engine checks passed.`,detail:JSON.stringify({steps,firstCount,secondCount,thirdCount,authenticated_role:actor.user.role,access_route:'Authenticated fixture harness; not ordinary-user proof'}),recorded_by:'collectorSelfTest',evidence_class:'Isolated synthetic engine test, not live monitoring'});
    return json({run_ref:runRef,steps,note:'Synthetic engine fixture only. No regulatory alert or approved business decision created.'});
  } catch(error){return json({error:error.message},500);}
}