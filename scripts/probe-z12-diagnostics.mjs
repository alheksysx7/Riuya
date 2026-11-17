import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {collectDiagnostics} from './local-diagnostics.mjs';

export async function probeDiagnostics({status,id}){
 const target=new URL(status.DB_URL);
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||target.hostname!=='127.0.0.1'||target.port==='54322')throw Error('LAB_SCOPE_INVALID');
 const db=new pg.Client({connectionString:status.DB_URL}),locker=new pg.Client({connectionString:status.DB_URL}),waiter=new pg.Client({connectionString:status.DB_URL});
 const ids=[randomUUID(),randomUUID(),randomUUID()],tag='z12-diagnostic-'+randomUUID(),secret='SENSITIVE_FAKE_PAYLOAD';
 let locked=false,waiting;
 await Promise.all([db.connect(),locker.connect(),waiter.connect()]);
 try{
  const baseline=await collectDiagnostics(db);
  await db.query(`insert into private.jobs(id,job_type,payload,dedupe_key,status,available_at,locked_by,lease_token,lease_until)
   values($1,'draft.generate',jsonb_build_object('secret',$4::text),$5,'queued',now()-interval '10 minutes',null,null,null),
   ($2,'draft.generate','{}',$6,'failed',now(),null,null,null),
   ($3,'draft.generate','{}',$7,'running',now(),'fake-worker',gen_random_uuid(),now()-interval '1 minute')`,
   [...ids,secret,tag+'-queued',tag+'-failed',tag+'-running']);
  const measured=await collectDiagnostics(db);
  assert.equal(measured.cola.pendientes,baseline.cola.pendientes+1);
  assert.equal(measured.cola.disponibles,baseline.cola.disponibles+1);
  assert.equal(measured.cola.atrasados,baseline.cola.atrasados+1);
  assert.equal(measured.cola.fallidos,baseline.cola.fallidos+1);
  assert.equal(measured.cola.en_ejecucion,baseline.cola.en_ejecucion+1);
  assert.equal(measured.cola.leases_vencidos,baseline.cola.leases_vencidos+1);
  assert(measured.cola.espera_mas_antigua_segundos>=600);
  assert(!JSON.stringify(measured).includes(secret));
  await locker.query('begin');locked=true;
  await locker.query('select id from private.jobs where id=$1 for update',[ids[0]]);
  await waiter.query("set lock_timeout='10s'");
  waiting=waiter.query('update private.jobs set updated_at=now() where id=$1',[ids[0]]).then(()=>true,()=>false);
  let found=false;
  for(let i=0;i<40&&!found;i++){found=(await collectDiagnostics(db)).bloqueosEnEspera>baseline.bloqueosEnEspera;if(!found)await new Promise(resolve=>setTimeout(resolve,50));}
  assert(found,'LAB_WAITING_LOCK_NOT_DETECTED');
  await locker.query('rollback');locked=false;assert.equal(await waiting,true);waiting=null;
  console.log('Z12 diagnóstico aislado: cola, retrasos, lease, bloqueo y privacidad: OK');
 }finally{
  if(locked)await locker.query('rollback').catch(()=>{});
  if(waiting)await waiting;
  await db.query('delete from private.jobs where id=any($1::uuid[]) and dedupe_key in ($2,$3,$4)',[ids,tag+'-queued',tag+'-failed',tag+'-running']).catch(()=>{});
  await Promise.allSettled([db.end(),locker.end(),waiter.end()]);
 }
}
