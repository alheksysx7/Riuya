import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import pg from 'pg';
const pw=readFileSync('.env.worker.local','utf8').match(/^RIUYA_WORKER_PASSWORD=([a-f0-9]{64})$/m)?.[1];if(!pw)throw Error('Worker no configurado');
const sql=q=>execFileSync('docker',['exec','-i','supabase_db_app','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
if(sql("select count(*) from private.jobs where status in ('queued','running')")!=='0')throw Error('Hay trabajos activos; no se ejecutó la prueba.');
const a=randomUUID(),b=randomUUID(),tag='z09-race-'+randomUUID();const clients=[0,1].map(()=>new pg.Client({host:'127.0.0.1',port:54322,user:'riuya_worker_local',password:pw,database:'postgres'}));
try{
 sql(`insert into private.jobs(id,job_type,payload,dedupe_key) values('${a}','draft.generate','{}','${tag}-a'),('${b}','draft.generate','{}','${tag}-b');`);
 await Promise.all(clients.map(c=>c.connect()));
 const results=await Promise.all(clients.map((c,i)=>c.query('select private.claim_job($1,60) job',['race-'+i])));const jobs=results.map(x=>x.rows[0].job).filter(Boolean);
 assert.equal(jobs.length,1);assert([a,b].includes(jobs[0].id));
 const old=jobs[0];sql(`update private.jobs set lease_until=now()-interval '1 second' where id='${old.id}' and dedupe_key in ('${tag}-a','${tag}-b');`);
 const stale=await clients[0].query('select private.finish_job($1,$2,true) ok',[old.id,old.leaseToken]);assert.equal(stale.rows[0].ok,false);
 const next=await clients[1].query('select private.claim_job($1,60) job',['race-recovery']);assert(next.rows[0].job);assert.notEqual(next.rows[0].job.leaseToken,old.leaseToken);
 console.log('Z09 concurrencia: dos workers, exclusión y lease vencido: OK');
}finally{
 await Promise.all(clients.map(c=>c.end().catch(()=>{})));
 sql(`delete from private.jobs where id in ('${a}','${b}') and dedupe_key in ('${tag}-a','${tag}-b');`);
}
