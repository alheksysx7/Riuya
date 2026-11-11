import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const u=randomUUID(),s=randomUUID(),r1=randomUUID(),r2=randomUUID(),j1=randomUUID(),j2=randomUUID(),t1=randomUUID(),t2=randomUUID();
const a=new pg.Client({connectionString:status.DB_URL}),b=new pg.Client({connectionString:status.DB_URL}),observer=new pg.Client({connectionString:status.DB_URL});
let setup=false;
async function waiting(pid){
 for(let i=0;i<80;i++){
  const q=await observer.query("select wait_event_type from pg_stat_activity where pid=$1",[pid]);
  if(q.rows[0]?.wait_event_type==='Lock')return;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('La operación no esperó el bloqueo esperado');
}
try{
 await Promise.all([a.connect(),b.connect(),observer.connect()]);
 await observer.query('begin');
 await observer.query('insert into auth.users(id,email) values($1,$2)',[u,'z11-race-'+u+'@example.invalid']);
 await observer.query("insert into private.profiles(id,account_status) values($1,'deletion_pending')",[u]);
 await observer.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,now())',[s,u]);
 await observer.query("insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values($1,$2,now()-interval '6 days',now()+interval '1 day','pending')",[r1,u]);
 await observer.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4,'running','z11-race',$5,now()+interval '5 minutes')",[j1,r1,'z11-race:'+j1,u,t1]);
 await observer.query('commit');setup=true;
 const timestamp=Number((await observer.query('select extract(epoch from now())::bigint t')).rows[0].t);
 const claims=JSON.stringify({sub:u,session_id:s,amr:[{method:'password',timestamp}]});
 const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
 const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 await a.query('begin');await a.query('set local role riuya_deletion_user');
 await a.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[u,claims]);
 assert.equal((await a.query('select api.recover_account_deletion() r')).rows[0].r.status,'active');
 await b.query('begin');await b.query('set local role riuya_purge_executor');
 const purgeBlocked=b.query('select private.begin_account_purge($1,$2)',[j1,t1]).then(()=>null,e=>e);
 await waiting(pidB);await a.query('commit');
 const purgeError=await purgeBlocked;assert.match(purgeError?.message||'',/PURGE_UNAVAILABLE|PURGE_LEASE_INVALID/);await b.query('rollback');
 let result=await observer.query('select account_status from private.profiles where id=$1',[u]);assert.equal(result.rows[0].account_status,'active');
 await observer.query("update private.profiles set account_status='deletion_pending' where id=$1",[u]);
 await observer.query("insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values($1,$2,now()-interval '8 days',now()-interval '1 day','pending')",[r2,u]);
 await observer.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4,'running','z11-race',$5,now()+interval '5 minutes')",[j2,r2,'z11-race:'+j2,u,t2]);
 await b.query('begin');await b.query('set local role riuya_purge_executor');
 assert.equal((await b.query('select private.begin_account_purge($1,$2) r',[j2,t2])).rows[0].r.stage,'started');
 await a.query('begin');await a.query('set local role riuya_deletion_user');
 await a.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[u,claims]);
 const recoverBlocked=a.query('select api.recover_account_deletion()').then(()=>null,e=>e);
 await waiting(pidA);await b.query('commit');
 const recoverError=await recoverBlocked;assert.match(recoverError?.message||'',/RECOVERY_UNAVAILABLE/);await a.query('rollback');
 result=await observer.query('select status from private.account_deletion_requests where id=$1',[r2]);assert.equal(result.rows[0].status,'purging');
 console.log('Z11 carreras: recuperación y purga se serializan en ambos órdenes: OK');
}finally{
 await Promise.all([a.query('rollback').catch(()=>{}),b.query('rollback').catch(()=>{}),observer.query('rollback').catch(()=>{})]);
 if(setup){
  await observer.query('delete from private.account_purge_operations where job_id=any($1::uuid[])',[[j1,j2]]);
  await observer.query('delete from private.jobs where id=any($1::uuid[]) and created_by=$2',[[j1,j2],u]);
  await observer.query('delete from auth.users where id=$1 and email=$2',[u,'z11-race-'+u+'@example.invalid']);
 }
 await Promise.all([a.end().catch(()=>{}),b.end().catch(()=>{}),observer.end().catch(()=>{})]);
}
