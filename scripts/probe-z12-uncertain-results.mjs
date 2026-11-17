import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {measureSurfaceContrast} from './probe-z12-surface-contrast.mjs';

export async function probeUncertainResults({db,browser,authenticatedPage,id,appPort,userId}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||
  !/^[a-f0-9-]{36}$/.test(userId))throw Error('LAB_SCOPE_INVALID');
 const article=randomUUID(),revision=randomUUID(),fixtures=Array.from({length:10},()=>randomUUID());
 await db.query('begin');
 try{
  await db.query("insert into auth.users(id,email) select id,'results-'||id::text||'@example.invalid' from unnest($1::uuid[]) id",[fixtures]);
  await db.query('insert into private.profiles(id) select unnest($1::uuid[])',[fixtures]);
  await db.query('insert into private.articles(id,category_id) select $1,id from private.categories order by id limit 1',[article]);
  await db.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values($1,$2,1,'SIMULACIÓN resultados','Resumen ficticio','[]'::jsonb)",[revision,article]);
  await db.query("insert into private.opinions(revision_id,character_id,body) select $1,id,'Opinión ficticia de resultados.' from private.characters where is_active",[revision]);
  await db.query("update private.articles set status='published',published_at=now(),current_revision_id=$1 where id=$2",[revision,article]);
  await db.query("insert into private.participations(user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) select id,$2,$3,'none',gen_random_uuid(),repeat('a',64) from unnest($1::uuid[]) id",[fixtures,article,revision]);
  await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
 const state=await authenticatedPage.context().storageState();
 const context=await browser.newContext({storageState:state,serviceWorkers:'allow'}),page=await context.newPage();
 const base='http://127.0.0.1:'+appPort;
 const snapshot=async()=>(await db.query("select s.full_results_seen_at,(select count(*)::int from private.participations p where p.user_id=$1 and p.article_id=$2) n from private.article_user_state s where s.user_id=$1 and s.article_id=$2",[userId,article])).rows[0];
 const pattern='**/api/v1/news/'+article+'/results/access';
 try{
  await page.goto(base+'/noticias/'+article);
  await page.getByRole('button',{name:'Omitir noticia'}).click();
  let omitted=false;
  for(let i=0;i<50&&!omitted;i++){omitted=(await db.query('select exists(select 1 from private.article_user_state where user_id=$1 and article_id=$2 and omitted_at is not null) ok',[userId,article])).rows[0].ok;if(!omitted)await new Promise(resolve=>setTimeout(resolve,100));}
  assert(omitted,'LAB_OMIT_NOT_SAVED');
  await page.goto(base+'/noticias/'+article);
  await page.getByRole('button',{name:'Ver resultados'}).waitFor();
  let accesses=0,delivered,status,dropError=false,finishDrop;
  const dropped=new Promise(resolve=>{finishDrop=resolve;});
  const drop=async(route,request)=>{
   if(request.method()!=='POST')return route.continue();
   accesses++;
   try{const response=await route.fetch();status=response.status();delivered=await response.json();}
   catch{dropError=true;}
   try{await route.abort('failed');}catch{dropError=true;}
   finishDrop();
  };
  await page.route(pattern,drop);
  await page.getByRole('button',{name:'Ver resultados'}).click();
  let timeout;try{await Promise.race([dropped,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('LAB_RESULTS_INTERCEPTION_TIMEOUT')),15000);})]);}finally{clearTimeout(timeout);}
  assert.equal(dropError,false,'LAB_RESULTS_INTERCEPTION_FAILED');
  assert.equal(status,200);
  assert.equal(delivered.mode,'complete');assert.equal(delivered.participationLocked,true);
  await page.getByRole('button',{name:'Reintentar consulta de resultados'}).waitFor();
  await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent==='Reintentar consulta de resultados');return button&&!button.disabled;});
  assert.equal(await page.getByRole('button',{name:'♡ Me gusta'}).first().isDisabled(),true);
  const marked=await snapshot();assert(marked.full_results_seen_at);assert.equal(marked.n,0);
  await page.unroute(pattern,drop);
  const observe=async(route,request)=>{if(request.method()==='POST')accesses++;await route.continue();};
  await page.route(pattern,observe);
  await page.reload();
  await page.getByRole('button',{name:'Reintentar consulta de resultados'}).waitFor();
  await new Promise(resolve=>setTimeout(resolve,1000));
  assert.equal(accesses,1,'LAB_RESULTS_UNEXPECTED_AUTOMATIC_RETRY');
  assert.equal(await page.getByRole('button',{name:'♡ Me gusta'}).first().isDisabled(),true);
  await page.getByRole('button',{name:'Reintentar consulta de resultados'}).click();
  await page.getByRole('heading',{name:'Así respondieron'}).waitFor();
  assert.equal(await page.locator('.support-row').count(),9,'LAB_SUPPORT_ROW_COUNT');
  for(const item of delivered.community.support){
   const row=page.locator('.support-row[data-key="'+item.key+'"]');
   assert.equal(await row.locator('.support-track').getAttribute('aria-hidden'),'true');
   assert.equal(await row.locator('.support-fill').evaluate(el=>el.style.width),item.percentage+'%','LAB_SUPPORT_WIDTH');
  }
  let minContrast=Infinity,pixelCount=0;
  const previousViewport=page.viewportSize(),contrastCdp=await page.context().newCDPSession(page);
  for(const scheme of ['light','dark'])for(const width of [360,1200]){
   await contrastCdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-transparency',value:'no-preference'}]});
   await page.setViewportSize({width,height:900});
   assert.match(await page.locator('.results-panel').evaluate(el=>getComputedStyle(el).backdropFilter),/blur\(12px\)/);
   const check=await measureSurfaceContrast({page,selector:'.results-panel,.share-card',label:'resultados completos '+scheme+' '+width});
   minContrast=Math.min(minContrast,check.minimum);pixelCount+=check.total;
  }
  await contrastCdp.detach();await page.emulateMedia({colorScheme:'light'});await page.setViewportSize(previousViewport);
  console.log('Z12 contraste de resultados completos: mínimo muestreado '+minContrast.toFixed(2)+':1; '+pixelCount+' píxeles: OK');
  assert.equal(accesses,2);
  const after=await snapshot();assert.equal(after.n,0);assert.equal(after.full_results_seen_at.getTime(),marked.full_results_seen_at.getTime());
  const result=await page.evaluate(async({article,revision})=>{
   const response=await fetch('/api/v1/news/'+article+'/participation',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({revisionId:revision,operationId:crypto.randomUUID(),choiceKind:'none',opinionIds:[]})});
   return {status:response.status,body:await response.json()};
  },{article,revision});
  assert.equal(result.status,409);assert.equal(result.body.error,'PARTICIPATION_LOCKED');
  assert.equal((await snapshot()).n,0);
  console.log('Z12 resultados interrumpidos: bloqueo conservado y reintento explícito: OK');
 }finally{await context.close();}
}
