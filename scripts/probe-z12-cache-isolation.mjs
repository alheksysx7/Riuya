import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';

export async function probeCacheIsolation({db,browser,authenticatedPage,id,appPort,userId,admin}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||
  !/^[a-f0-9-]{36}$/.test(userId)||!admin?.auth?.admin)throw Error('LAB_SCOPE_INVALID');
 const article=randomUUID(),revision=randomUUID(),marker='SIMULACIÓN privada '+randomUUID();
 const email='cache-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
 if(created.error||!created.data.user)throw Error('LAB_CACHE_USER_CREATE_FAILED');
 await db.query('begin');
 try{
  await db.query('insert into private.articles(id,category_id) select $1,id from private.categories order by id limit 1',[article]);
  await db.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values($1,$2,1,$3,'Resumen ficticio','[]'::jsonb)",[revision,article,marker]);
  await db.query("insert into private.opinions(revision_id,character_id,body) select $1,id,'Opinión ficticia.' from private.characters where is_active",[revision]);
  await db.query("update private.articles set status='published',published_at=now(),current_revision_id=$1 where id=$2",[revision,article]);
  await db.query('insert into private.article_user_state(user_id,article_id) values($1,$2)',[userId,article]);
  await db.query("insert into private.participations(user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) values($1,$2,$3,'none',gen_random_uuid(),repeat('a',64))",[userId,article,revision]);
  await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
 const state=await authenticatedPage.context().storageState();
 const context=await browser.newContext({storageState:state,serviceWorkers:'allow'}),page=await context.newPage();
 const base='http://127.0.0.1:'+appPort;
 try{
  await page.goto(base+'/actividad');
  await page.getByRole('link',{name:marker}).waitFor();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await page.getByRole('link',{name:marker}).waitFor();
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await page.goto(base+'/cuenta');
  await page.getByLabel('Correo').fill(email);await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.getByRole('button',{name:'Cerrar sesión'}).waitFor();
  await page.goto(base+'/actividad');
  await page.getByRole('heading',{name:'Mi actividad'}).waitFor();
  assert.equal(await page.getByText(marker).count(),0,'LAB_CACHE_OTHER_USER_VISIBLE');
  const activity=await page.evaluate(async()=>{const r=await fetch('/api/v1/me/activity',{cache:'no-store'});return {status:r.status,body:await r.text()};});
  assert.equal(activity.status,200);assert(!activity.body.includes(marker),'LAB_CACHE_OTHER_USER_API');
  await context.setOffline(true);await page.goto(base+'/actividad');
  await page.getByRole('heading',{name:'No hay conexión'}).waitFor();
  assert.equal(await page.getByText(marker).count(),0,'LAB_CACHE_OFFLINE_PRIVATE');
  await context.setOffline(false);
  await page.goto(base+'/noticias/'+article);
  await page.getByRole('heading',{name:marker}).waitFor();
  await db.query("update private.articles set status='withdrawn',withdrawn_at=now(),withdrawal_reason='Prueba ficticia' where id=$1",[article]);
  const withdrawn=await page.reload();
  assert.equal(withdrawn.status(),404,'LAB_WITHDRAWN_HTML_VISIBLE');
  assert.equal(await page.getByText(marker).count(),0,'LAB_WITHDRAWN_TEXT_VISIBLE');
  const response=await page.request.get(base+'/api/v1/news/'+article);
  assert.equal(response.status(),404);assert(!(await response.text()).includes(marker));
  const cached=await page.evaluate(async()=>{const cache=await caches.open('riuya-offline-v2');return (await cache.keys()).map(x=>new URL(x.url).pathname);});
  assert.deepEqual(cached,['/offline.html']);
  console.log('Z12 privacidad: cambio de cuenta, desconexión y noticia retirada sin contenido anterior: OK');
 }finally{await context.close();}
}
