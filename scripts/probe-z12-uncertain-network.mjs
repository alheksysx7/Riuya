import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function probeUncertainNetwork({db,browser,authenticatedPage,id,appPort,userId}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||
  !/^[a-f0-9-]{36}$/.test(userId))throw Error('LAB_SCOPE_INVALID');
 const items=[0,1].map(()=>({article:randomUUID(),revision:randomUUID()}));
 await db.query('begin');
 try{
  for(const item of items){
   await db.query('insert into private.articles(id,category_id) select $1,id from private.categories order by id limit 1',[item.article]);
   await db.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values($1,$2,1,'SIMULACIÓN conexión','Resumen ficticio','[]'::jsonb)",[item.revision,item.article]);
   await db.query("insert into private.opinions(revision_id,character_id,body) select $1,id,'Opinión ficticia de conexión.' from private.characters where is_active",[item.revision]);
   await db.query("update private.articles set status='published',published_at=now(),current_revision_id=$1 where id=$2",[item.revision,item.article]);
  }
  await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
 const state=await authenticatedPage.context().storageState();
 const context=await browser.newContext({storageState:state,serviceWorkers:'allow'}),page=await context.newPage();
 const base='http://127.0.0.1:'+appPort;
 const count=async article=>(await db.query('select count(*)::int n from private.participations where user_id=$1 and article_id=$2',[userId,article])).rows[0].n;
 const begin=async article=>{
  await page.goto(base+'/noticias/'+article);
  await page.getByRole('button',{name:'♡ Me gusta'}).first().click();
  await page.getByRole('button',{name:'Revisar selección'}).click();
  await page.getByRole('button',{name:'Confirmar elección'}).click();
 };
 try{
  let committedInput,receipt;
  const committedPattern='**/api/v1/news/'+items[0].article+'/participation';
  const dropAfterCommit=async(route,request)=>{
   if(request.method()!=='POST')return route.continue();
   committedInput=request.postDataJSON();
   const response=await route.fetch();assert.equal(response.status(),200);receipt=await response.json();
   await route.abort('failed');
  };
  await page.route(committedPattern,dropAfterCommit);
  await begin(items[0].article);
  await page.getByText('Respuesta confirmada. No puedes cambiarla.').waitFor();
  await page.unroute(committedPattern,dropAfterCommit);
  assert.equal(await count(items[0].article),1);
  const again=await page.evaluate(async({article,payload})=>{
   const response=await fetch('/api/v1/news/'+article+'/participation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   return {status:response.status,data:await response.json()};
  },{article:items[0].article,payload:committedInput});
  assert.equal(again.status,200);assert.equal(again.data.id,receipt.id);assert.equal(await count(items[0].article),1);

  let interruptedInput,retryInput,posts=0;
  const pendingPattern='**/api/v1/news/'+items[1].article+'/participation';
  const dropBeforeCommit=async(route,request)=>{
   if(request.method()!=='POST')return route.continue();
   posts++;interruptedInput=request.postDataJSON();await route.abort('failed');
  };
  await page.route(pendingPattern,dropBeforeCommit);
  await begin(items[1].article);
  await page.getByRole('button',{name:'Reintentar la misma confirmación'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'♡ Me gusta'}).first().isDisabled(),true);
  assert.equal(await count(items[1].article),0);
  await page.unroute(pendingPattern,dropBeforeCommit);
  const observe=async(route,request)=>{if(request.method()==='POST'){posts++;retryInput=request.postDataJSON();}await route.continue();};
  await page.route(pendingPattern,observe);
  await page.reload();
  await page.getByRole('button',{name:'Reintentar la misma confirmación'}).waitFor();
  await new Promise(resolve=>setTimeout(resolve,1000));
  assert.equal(posts,1,'LAB_UNEXPECTED_AUTOMATIC_RESEND');
  assert.equal(await count(items[1].article),0);
  await page.getByRole('button',{name:'Reintentar la misma confirmación'}).click();
  await page.getByText('Respuesta confirmada. No puedes cambiarla.').waitFor();
  assert.equal(posts,2);assert.deepEqual(retryInput,interruptedInput);assert.equal(await count(items[1].article),1);
  console.log('Z12 interrupción de participación: recuperación idempotente y reintento explícito sin duplicados: OK');
 }finally{await context.close();}
}
