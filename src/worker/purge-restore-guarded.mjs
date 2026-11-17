import {replayRestoredPurges} from './purge-restore-replay.mjs';
import {checkLocalRestoreIsolation} from './purge-restore-isolation-local.mjs';
import {verifyPurgeStorageSeparation} from './purge-storage-readiness.mjs';

// El operador sigue siendo responsable de mantener aisladas las superficies no verificadas.
export async function replayLocallyGuarded({auditDb,restoreDb,workerDb,journal,runJob,offline,
 checkIsolation=checkLocalRestoreIsolation,checkCustody=verifyPurgeStorageSeparation}){
 if(offline!==true||typeof checkIsolation!=='function'||typeof checkCustody!=='function'||!restoreDb?.query||typeof runJob!=='function')throw Error('PURGE_RESTORE_OFFLINE_REQUIRED');
 const guard=async()=>{
  await checkCustody(journal);
  const result=await checkIsolation();
  if(result?.blocked!==false)throw Error('PURGE_RESTORE_ISOLATION_BLOCKED');
 };
 await guard();
 const guardedRestoreDb={async query(sql,args){await guard();return restoreDb.query(sql,args);}};
 const guardedRunJob=async options=>{await guard();return runJob(options);};
 const result=await replayRestoredPurges({auditDb,restoreDb:guardedRestoreDb,workerDb,journal,runJob:guardedRunJob,offline:true});
 await guard();
 return result;
}
