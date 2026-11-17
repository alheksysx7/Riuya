import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {initializePurgeJournal,recordPurgeIntent,initializePurgeCheckpoint} from '../src/worker/purge-journal.mjs';
import {replayRestoredPurges} from '../src/worker/purge-restore-replay.mjs';
import {processAccountPurge} from '../src/worker/purge-account.mjs';
import {createLocalPurgeAuthAdmin} from '../src/worker/purge-auth.mjs';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const dir=await mkdtemp(join(tmpdir(),'riuya-replay-test-')),journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor'};
const adminClient=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createLocalPurgeAuthAdmin({apiUrl:status.API_URL,serviceRoleKey:status.SERVICE_ROLE_KEY});
const db=new pg.Client({connectionString:status.DB_URL}),users=[],requestId=randomUUID();let connected=false,jobId;
const asRole=role=>({async query(sql,args){await db.query('begin');try{await db.query('set local role '+role);const value=await db.query(sql,args);await db.query('commit');return value;}catch(e){await db.query('rollback');throw e;}}});
async function createUser(){
 const result=await adminClient.auth.admin.createUser({email:'z11-replay-'+randomUUID()+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 if(result.error||!result.data.user)throw Error('TEST_USER_CREATE');
 users.push(result.data.user.id);return result.data.user.id;
}
try{
 journal.checkpointPath=journal.dir+'.checkpoint';await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);await db.connect();connected=true;
 const u=await createUser(),witness=await createUser();
 await db.query('insert into private.profiles(id) values($1),($2) on conflict(id) do nothing',[u,witness]);
 await recordPurgeIntent({...journal,requireCheckpoint:true,requestId,userId:u});
 const auditDb=asRole('riuya_restore_auditor'),restoreDb=asRole('riuya_restore_client'),workerDb=asRole('riuya_purge_worker_client');
 const runJob=({db,job})=>processAccountPurge({db,job,admin,journal,storageConfig:{apiUrl:status.API_URL,anonKey:status.ANON_KEY,jwtSecret:status.JWT_SECRET}});
 const args={auditDb,restoreDb,workerDb,journal,runJob,offline:true};
 await assert.rejects(()=>replayRestoredPurges({...args,offline:false}),/PURGE_RESTORE_OFFLINE_REQUIRED/);
 assert.equal((await adminClient.auth.admin.getUserById(u)).error,null);
 await assert.rejects(()=>replayRestoredPurges({...args,runJob:async()=>{throw Error('SIMULATED_CRASH');}}),/SIMULATED_CRASH/);
 const q=await db.query("select id from private.jobs where created_by=$1 and locked_by='restore-offline'",[u]);assert.equal(q.rows.length,1);jobId=q.rows[0].id;
 assert.equal((await db.query('select account_status from private.profiles where id=$1',[u])).rows[0].account_status,'deletion_pending');
 await assert.rejects(()=>replayRestoredPurges(args),/RESTORE_IN_PROGRESS/);
 await db.query("update private.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[jobId]);
 const result=await replayRestoredPurges(args);assert.deepEqual(result,{recorded:1,remaining:0,cleared:1,inconsistent:0,ready:true});
 assert.equal((await adminClient.auth.admin.getUserById(u)).error?.status,404);
 assert.equal((await adminClient.auth.admin.getUserById(witness)).error,null);
 assert.equal((await replayRestoredPurges(args)).ready,true);
 console.log('Z11 restauración: reaplicación real, interrupción, reintento y otra cuenta: OK');
}finally{
 if(connected)await db.query('rollback').catch(()=>{});
 if(connected&&jobId){await db.query('delete from private.account_purge_operations where job_id=$1',[jobId]);await db.query('delete from private.jobs where id=$1',[jobId]);}
 for(const user of users){const r=await adminClient.auth.admin.deleteUser(user);if(r.error&&r.error.status!==404)throw Error('TEST_USER_CLEANUP');}
 if(connected)await db.end().catch(()=>{});
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});await unlink(journal.anchorPath).catch(()=>{});await unlink(journal.checkpointPath).catch(()=>{});await rmdir(dir);
}
