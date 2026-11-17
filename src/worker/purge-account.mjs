import {createScopedPurgeStorage} from './purge-storage-auth.mjs';
import {clearPurgeStorage} from './purge-storage.mjs';
import {purgePreparedAuth} from './purge-auth.mjs';

// Handler aislado; no está conectado a la cola general hasta terminar Z11.
export async function processAccountPurge({db,job,admin,storageConfig,journal}){
 if(!db||typeof db.query!=='function'||job?.type!=='account.purge'||!job.id||!job.leaseToken)throw Error('PURGE_JOB_INVALID');
 const readState=async()=>{
  const response=await db.query('select private.begin_account_purge($1,$2) state',[job.id,job.leaseToken]);
  const state=response?.rows?.[0]?.state;
  if(!state?.stage||!state.userId)throw Error('PURGE_STATE_INVALID');
  return state;
 };
 let state=await readState();
 if(state.stage==='started'){
  await db.query('select private.purge_account_contributions($1,$2)',[job.id,job.leaseToken]);state=await readState();
 }
 if(state.stage==='contributions_removed'){
  await db.query('select private.purge_editorial_references($1,$2)',[job.id,job.leaseToken]);state=await readState();
 }
 if(state.stage==='editorial_cleaned'){
  const storageFactory=()=>createScopedPurgeStorage({...storageConfig,userId:state.userId,jobId:job.id,leaseToken:job.leaseToken,leaseUntil:job.leaseUntil});
  await clearPurgeStorage({db,storageFactory,job});
 }else if(state.stage!=='prepared')throw Error('PURGE_STATE_INVALID');
 await purgePreparedAuth({db,job,admin,journal});
}
