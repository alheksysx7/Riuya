import pg from 'pg';
import {loadConfiguredPurgeJournal} from './purge-local-journal.mjs';
import {loadCurrentPurgeIntents} from './purge-journal.mjs';
import {checkLocalRestoreIsolation} from './purge-restore-isolation-local.mjs';
import {verifyPurgeStorageSeparation} from './purge-storage-readiness.mjs';
import {inspectRestorePurges,hasUnattributedRestoreStorage} from './purge-restore-audit.mjs';
import {createRestoreInternalFetch} from './purge-restore-internal-fetch.mjs';
import {requireLocalRestoreDbUrl} from './purge-restore-config.mjs';

// Diagnóstico de solo lectura: no bloquea tráfico ni autoriza la reapertura.
export async function checkRecoveryReadiness({env=process.env,projectId='app',
 clientFactory=url=>new pg.Client({connectionString:url,connectionTimeoutMillis:5000}),
 checkIsolation=checkLocalRestoreIsolation,checkCustody=verifyPurgeStorageSeparation,
 bridgeFactory=createRestoreInternalFetch}={}){
 const url=requireLocalRestoreDbUrl(env.RIUYA_RESTORE_AUDIT_DATABASE_URL);
 const {journal}=await loadConfiguredPurgeJournal(env);
 const records=await loadCurrentPurgeIntents(journal);await checkCustody(journal);
 let isolation=await checkIsolation();
 if(isolation?.blocked!==false)return {checksPassed:false,stage:'isolation',blockers:isolation?.blockers||[]};
 const bridge=bridgeFactory({projectId});
 let health;
 try{health=await Promise.all([bridge('http://127.0.0.1:54321/auth/v1/health'),bridge('http://127.0.0.1:54321/storage/v1/status')]);}
 catch{throw Error('PURGE_RESTORE_SERVICES_UNAVAILABLE');}
 if(health.some(response=>!response.ok))throw Error('PURGE_RESTORE_SERVICES_UNAVAILABLE');
 const db=clientFactory(url);
 let report,unattributed;
 try{
  await db.connect();
  await db.query('begin isolation level repeatable read read only');
  await db.query('set local role riuya_restore_auditor');
  report=await inspectRestorePurges({db,journal});
  unattributed=await hasUnattributedRestoreStorage({db,journal});
 }finally{await db.query('rollback').catch(()=>{});await db.end().catch(()=>{});}
 await checkCustody(journal);
 isolation=await checkIsolation();
 if(isolation?.blocked!==false)return {checksPassed:false,stage:'isolation',blockers:isolation?.blockers||[]};
 const after=await loadCurrentPurgeIntents(journal);
 if(JSON.stringify(records)!==JSON.stringify(after))throw Error('PURGE_RESTORE_JOURNAL_CHANGED');
 return {checksPassed:report.ready&&!unattributed,stage:'audit',report,unattributed};
}
