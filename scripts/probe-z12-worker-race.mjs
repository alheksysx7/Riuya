import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

// La prueba reclama únicamente trabajos creados en el proyecto temporal.
export async function probeWorkerRace({status,id}){
 const target=new URL(status.DB_URL);
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||target.hostname!=='127.0.0.1'||target.port==='54322')throw Error('LAB_SCOPE_INVALID');
 const db=new pg.Client({connectionString:status.DB_URL}),password=randomBytes(32).toString('hex');
 const ids=[randomUUID(),randomUUID()],tag='z12-race-'+randomUUID();
 await db.connect();let clients=[];
 try{
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running') and job_type<>'account.purge'")).rows[0].n,0);
  await db.query("create role riuya_z12_race login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+password+"'");
  await db.query('grant riuya_worker_client to riuya_z12_race');
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key) values($1,'draft.generate','{}',$3),($2,'draft.generate','{}',$4)",[ids[0],ids[1],tag+'-a',tag+'-b']);
  const url=new URL(status.DB_URL);url.username='riuya_z12_race';url.password=password;
  clients=[new pg.Client({connectionString:url.toString()}),new pg.Client({connectionString:url.toString()})];
  await Promise.all(clients.map(c=>c.connect()));
  const results=await Promise.all(clients.map((c,i)=>c.query('select private.claim_job_filtered($1,60,false) job',['z12-race-'+i])));
  const jobs=results.map(r=>r.rows[0].job).filter(Boolean);
  assert.equal(jobs.length,1);assert(ids.includes(jobs[0].id));
  const old=jobs[0];await db.query("update private.jobs set lease_until=now()-interval '1 second' where id=$1 and dedupe_key in ($2,$3)",[old.id,tag+'-a',tag+'-b']);
  assert.equal((await clients[0].query('select private.finish_job($1,$2,true) ok',[old.id,old.leaseToken])).rows[0].ok,false);
  const next=(await clients[1].query("select private.claim_job_filtered('z12-race-recovery',60,false) job")).rows[0].job;
  assert(next&&ids.includes(next.id));assert.notEqual(next.leaseToken,old.leaseToken);
  console.log('Z12 laboratorio: reclamo filtrado concurrente y recuperación de lease: OK');
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
  await db.query('delete from private.jobs where id=any($1::uuid[]) and dedupe_key in ($2,$3)',[ids,tag+'-a',tag+'-b']);
  await db.end();
 }
}
