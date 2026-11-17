import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readdir,unlink,rmdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {createLocalPurgeAuthAdmin,purgePreparedAuth} from '../src/worker/purge-auth.mjs';
import {runLocalPurgeJob} from '../src/worker/purge-local.mjs';
import {recordPurgeIntent,loadPurgeIntents,initializePurgeJournal,initializePurgeCheckpoint} from '../src/worker/purge-journal.mjs';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const adminClient=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createLocalPurgeAuthAdmin({apiUrl:status.API_URL,serviceRoleKey:status.SERVICE_ROLE_KEY});
const journal={dir:await mkdtemp(join(tmpdir(),'riuya-auth-journal-')),key:randomBytes(32)};
journal.anchorPath=journal.dir+'.anchor';journal.checkpointPath=journal.dir+'.checkpoint';await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
const keyPath=journal.dir+'.key';await writeFile(keyPath,journal.key.toString('hex'),{flag:'wx',mode:0o600});
const db=new pg.Client({connectionString:status.DB_URL});const users=[],jobs=[];let connected=false;
const executor={async query(sql,args){await db.query('begin');try{await db.query('set local role riuya_purge_worker_client');const value=await db.query(sql,args);await db.query('commit');return value;}catch(e){await db.query('rollback');throw e;}}};
async function user(){
 const result=await adminClient.auth.admin.createUser({email:'z11-auth-'+randomUUID()+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 if(result.error||!result.data.user)throw Error('TEST_AUTH_CREATE');
 users.push(result.data.user.id);return result.data.user.id;
}
async function fixture(u,stage=true){
 const job={id:randomUUID(),leaseToken:randomUUID(),type:'account.purge',leaseUntil:new Date(Date.now()+240000)},rid=randomUUID();
 await db.query("insert into private.profiles(id,account_status,alias) values($1,'deletion_pending','fixture') on conflict(id) do update set account_status='deletion_pending',alias='fixture'",[u]);
 await db.query("insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values($1,$2,now()-interval '8 days',now()-interval '1 day','pending')",[rid,u]);
 await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4,'running','z11-auth-fixture',$5,now()+interval '5 minutes')",[job.id,rid,'z11-auth-'+job.id,u,job.leaseToken]);jobs.push(job.id);
 if(stage){await executor.query('select private.purge_account_contributions($1,$2)',[job.id,job.leaseToken]);
 await executor.query('select private.purge_editorial_references($1,$2)',[job.id,job.leaseToken]);}
 return job;
}
try{
 await db.connect();connected=true;
 const rights=await db.query("select has_table_privilege('riuya_purge_worker_client','private.profiles','select') profiles,has_table_privilege('riuya_purge_worker_client','private.jobs','select') jobs,has_function_privilege('riuya_purge_worker_client','private.purge_auth_user_missing(uuid,uuid)','execute') auth_helper,pg_has_role('riuya_worker_local','riuya_purge_worker_client','member') worker_enabled");
 assert.deepEqual(rights.rows[0],{profiles:false,jobs:false,auth_helper:false,worker_enabled:false});
 const first=await user(),second=await user(),third=await user(),witness=await user();
 const firstJob=await fixture(first);
 await assert.rejects(()=>purgePreparedAuth({db:executor,job:{...firstJob,leaseToken:randomUUID()},admin,journal}),/PURGE_LEASE_INVALID/);
 assert.equal((await adminClient.auth.admin.getUserById(first)).error,null);
 await assert.rejects(()=>purgePreparedAuth({db:executor,job:firstJob,admin,journal:{...journal,dir:join(journal.dir,'missing')}}),/PURGE_JOURNAL_WRITE_FAILED/);
 assert.equal((await adminClient.auth.admin.getUserById(first)).error,null);
 const originalAnchor=await readFile(journal.anchorPath,'utf8');await writeFile(journal.anchorPath,'{');
 try{
  await assert.rejects(()=>purgePreparedAuth({db:executor,job:firstJob,admin,journal}),/PURGE_JOURNAL_ANCHOR_INVALID/);
  assert.equal((await adminClient.auth.admin.getUserById(first)).error,null);
 }finally{await writeFile(journal.anchorPath,originalAnchor);}
 const savedCheckpoint=await readFile(journal.checkpointPath,'utf8');await writeFile(journal.checkpointPath,'{');
 try{
  await assert.rejects(()=>purgePreparedAuth({db:executor,job:firstJob,admin,journal}),/PURGE_CHECKPOINT_INVALID/);
  assert.equal((await adminClient.auth.admin.getUserById(first)).error,null);
 }finally{await writeFile(journal.checkpointPath,savedCheckpoint);}
 // Windows permite leer el archivo, pero deniega su apertura para escritura.
 if(process.platform==='win32'){
  const script="$f=[System.IO.File]::Open($env:RIUYA_TEST_CHECKPOINT,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [void][Console]::In.ReadLine() } finally { $f.Dispose() }";
  const locker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{
   env:{...process.env,RIUYA_TEST_CHECKPOINT:journal.checkpointPath},stdio:['pipe','pipe','pipe'],windowsHide:true});
  const exited=new Promise((resolve,reject)=>{locker.once('error',reject);locker.once('exit',(code)=>resolve(code));});
  try{
   await Promise.race([
    new Promise((resolve,reject)=>{locker.stdout.once('data',chunk=>chunk.toString().includes('LOCKED')?resolve():reject(Error('TEST_LOCK_NOT_ACQUIRED')));locker.once('error',reject);}),
    exited.then(()=>{throw Error('TEST_LOCK_PROCESS_EXITED');}),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('TEST_LOCK_TIMEOUT')),10000).unref())
   ]);
   await assert.rejects(()=>purgePreparedAuth({db:executor,job:firstJob,admin,journal}),/PURGE_CHECKPOINT_WRITE_FAILED/);
   assert.equal((await adminClient.auth.admin.getUserById(first)).error,null);
   assert.equal((await loadPurgeIntents(journal)).length,1);
   assert.equal(JSON.parse(await readFile(journal.checkpointPath,'utf8')).count,0);
  }finally{locker.stdin.end('release\n');await exited;}
 }
 await purgePreparedAuth({db:executor,job:firstJob,admin,journal});
 assert.equal(JSON.parse(await readFile(journal.checkpointPath,'utf8')).count,1);
 assert.equal((await adminClient.auth.admin.getUserById(first)).error?.status,404);
 let q=await db.query('select stage,user_id from private.account_purge_operations where job_id=$1',[firstJob.id]);assert.deepEqual(q.rows[0],{stage:'finalized',user_id:null});
 const secondJob=await fixture(second);
 await executor.query('select private.prepare_account_auth_purge($1,$2)',[secondJob.id,secondJob.leaseToken]);
 const ctx=(await executor.query('select private.purge_journal_context($1,$2) context',[secondJob.id,secondJob.leaseToken])).rows[0].context;
 await recordPurgeIntent({...journal,...ctx});
 const deletion=await adminClient.auth.admin.deleteUser(second);if(deletion.error)throw Error('TEST_DELETE');
 await purgePreparedAuth({db:executor,job:secondJob,admin,journal});
 assert.equal(JSON.parse(await readFile(journal.checkpointPath,'utf8')).count,2);
 q=await db.query('select stage,user_id from private.account_purge_operations where job_id=$1',[secondJob.id]);assert.deepEqual(q.rows[0],{stage:'finalized',user_id:null});
 const thirdJob=await fixture(third,false);
 await assert.rejects(()=>runLocalPurgeJob({db:executor,job:thirdJob,env:{},statusProvider:()=>status,verifyStorage:()=>{}}),/PURGE_JOURNAL_CONFIG_INVALID/);
 const insideKey=join(journal.dir,'key');await writeFile(insideKey,journal.key.toString('hex'),{flag:'wx',mode:0o600});
 try{
  await assert.rejects(()=>runLocalPurgeJob({db:executor,job:thirdJob,env:{RIUYA_PURGE_JOURNAL_DIR:journal.dir,RIUYA_PURGE_JOURNAL_KEY_FILE:insideKey,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath},statusProvider:()=>status,verifyStorage:()=>{}}),/PURGE_JOURNAL_CONFIG_INVALID/);
 }finally{await unlink(insideKey);}
 assert.equal((await adminClient.auth.admin.getUserById(third)).error,null);
 await runLocalPurgeJob({db:executor,job:thirdJob,env:{RIUYA_PURGE_JOURNAL_DIR:journal.dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath},statusProvider:()=>status,verifyStorage:()=>{}});
 assert.equal((await adminClient.auth.admin.getUserById(third)).error?.status,404);
 q=await db.query('select stage,user_id from private.account_purge_operations where job_id=$1',[thirdJob.id]);assert.deepEqual(q.rows[0],{stage:'finalized',user_id:null});
 assert.equal((await adminClient.auth.admin.getUserById(witness)).error,null);
 assert.equal((await loadPurgeIntents(journal)).length,3);
 console.log('Z11 Auth: eliminación, lease inválido, recuperación tras interrupción y handler completo: OK');
}finally{
 if(connected)await db.query('rollback').catch(()=>{});
 if(connected&&jobs.length){await db.query('delete from private.account_purge_operations where job_id=any($1::uuid[])',[jobs]);await db.query('delete from private.jobs where id=any($1::uuid[])',[jobs]);}
 for(const id of users){const result=await adminClient.auth.admin.deleteUser(id);if(result.error&&result.error.status!==404)throw Error('TEST_USER_CLEANUP');}
 if(connected)await db.end().catch(()=>{});
 for(const name of await readdir(journal.dir)){if(name!=='purges.ndjson')throw Error('TEST_JOURNAL_CLEANUP');await unlink(join(journal.dir,name));}
 await rmdir(journal.dir);await unlink(keyPath);await unlink(journal.anchorPath);await unlink(journal.checkpointPath);
}
