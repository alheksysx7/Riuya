import pg from 'pg';
import {loadConfiguredPurgeJournal} from './purge-local-journal.mjs';
import {loadCurrentPurgeIntents} from './purge-journal.mjs';
import {checkLocalRestoreIsolation} from './purge-restore-isolation-local.mjs';
import {verifyPurgeStorageSeparation} from './purge-storage-readiness.mjs';
import {createRestoreInternalFetch} from './purge-restore-internal-fetch.mjs';
import {createLocalPurgeAuthAdmin} from './purge-auth.mjs';
import {processAccountPurge} from './purge-account.mjs';
import {runWithPurgeHeartbeat} from './purge-heartbeat.mjs';
import {replayLocallyGuarded} from './purge-restore-guarded.mjs';

import {requireLocalRestoreDbUrl} from './purge-restore-config.mjs';

export async function runLocalRestore({env=process.env,offline=false,projectId='app',
 clientFactory=url=>new pg.Client({connectionString:url,connectionTimeoutMillis:5000}),
 checkIsolation=checkLocalRestoreIsolation,checkCustody=verifyPurgeStorageSeparation}={}){
 if(offline!==true)throw Error('PURGE_RESTORE_OFFLINE_REQUIRED');
 const roles=[
  ['riuya_restore_auditor',requireLocalRestoreDbUrl(env.RIUYA_RESTORE_AUDIT_DATABASE_URL),['private.restore_purge_audit(uuid[])','private.restore_storage_present(uuid[])','private.restore_unattributed_storage_present()']],
  ['riuya_restore_client',requireLocalRestoreDbUrl(env.RIUYA_RESTORE_CONTROL_DATABASE_URL),['private.restore_begin_purge(uuid,uuid)']],
  ['riuya_purge_worker_client',requireLocalRestoreDbUrl(env.RIUYA_RESTORE_WORKER_DATABASE_URL),['private.begin_account_purge(uuid,uuid)','private.purge_account_contributions(uuid,uuid)','private.purge_editorial_references(uuid,uuid)','private.purge_storage_inventory(uuid,uuid)','private.prepare_account_auth_purge(uuid,uuid)','private.purge_journal_context(uuid,uuid)','private.finish_account_purge(uuid,uuid)']],
  ['riuya_worker_client',requireLocalRestoreDbUrl(env.RIUYA_RESTORE_QUEUE_DATABASE_URL),['private.renew_job(uuid,uuid,integer)']]
 ];
 for(const name of ['RIUYA_RESTORE_ANON_KEY','RIUYA_RESTORE_SERVICE_ROLE_KEY','RIUYA_RESTORE_JWT_SECRET']){
  if(typeof env[name]!=='string'||!env[name])throw Error('PURGE_RESTORE_CONFIG_INVALID');
 }
 const {journal}=await loadConfiguredPurgeJournal(env);
 await loadCurrentPurgeIntents(journal);
 await checkCustody(journal);
 const preflight=await checkIsolation();
 if(preflight?.blocked!==false)throw Error('PURGE_RESTORE_ISOLATION_BLOCKED');
 const clients=[];
 try{
  for(const [role,url,functions] of roles){
   const client=clientFactory(url);clients.push(client);await client.connect();
   await client.query('set role '+role);
   for(const fn of functions){
    const result=await client.query("select current_user as role_name,has_function_privilege(current_user,$1,'execute') as allowed",[fn]);
    if(result.rows[0]?.role_name!==role||result.rows[0]?.allowed!==true)throw Error('PURGE_RESTORE_ROLE_INVALID');
   }
  }
  const [auditDb,restoreDb,workerDb,queueDb]=clients;
  const bridge=createRestoreInternalFetch({projectId});
  let health;
  try{health=await Promise.all([bridge('http://127.0.0.1:54321/auth/v1/health'),bridge('http://127.0.0.1:54321/storage/v1/status')]);}
  catch{throw Error('PURGE_RESTORE_SERVICES_UNAVAILABLE');}
  if(health.some(response=>!response.ok))throw Error('PURGE_RESTORE_SERVICES_UNAVAILABLE');
  const admin=createLocalPurgeAuthAdmin({apiUrl:'http://127.0.0.1:54321',serviceRoleKey:env.RIUYA_RESTORE_SERVICE_ROLE_KEY,restoreFetch:bridge});
  // La conexión adicional renueva el lease sin acortarlo de diez minutos a uno.
  const heart={async connect(){},query(...args){return queueDb.query(...args);},async end(){}};
  const runJob=({db,job})=>runWithPurgeHeartbeat({heart,job,leaseSeconds:600,run:()=>processAccountPurge({db,job,admin,journal,
   storageConfig:{apiUrl:'http://127.0.0.1:54321',anonKey:env.RIUYA_RESTORE_ANON_KEY,jwtSecret:env.RIUYA_RESTORE_JWT_SECRET,restoreFetch:bridge}})});
  return await replayLocallyGuarded({auditDb,restoreDb,workerDb,journal,runJob,offline:true,checkIsolation,checkCustody});
 }finally{
  for(const client of clients.reverse())await client.end().catch(()=>{});
 }
}
