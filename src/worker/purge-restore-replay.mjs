import {loadCurrentPurgeIntents} from './purge-journal.mjs';
import {auditRestoredPurges,hasUnattributedRestoreStorage,requireRestorePurgesComplete} from './purge-restore-audit.mjs';

// Uso operativo con el tráfico detenido; el llamador controla esa condición.
export async function replayRestoredPurges({auditDb,restoreDb,workerDb,journal,runJob,offline}){
 if(offline!==true||!auditDb?.query||!restoreDb?.query||!workerDb?.query||typeof runJob!=='function')throw Error('PURGE_RESTORE_OFFLINE_REQUIRED');
 const records=await loadCurrentPurgeIntents(journal),seen=new Map();
 for(const record of records){
  if(seen.has(record.userId)&&seen.get(record.userId)!==record.requestId)throw Error('PURGE_RESTORE_JOURNAL_AMBIGUOUS');
  seen.set(record.userId,record.requestId);
 }
 // Auditar todas las identidades antes de modificar cualquiera.
 if(await hasUnattributedRestoreStorage({db:auditDb,journal}))throw Error('PURGE_RESTORE_UNATTRIBUTED_STORAGE');
 const preflight=await auditRestoredPurges({db:auditDb,journal});
 if(preflight.inconsistent>0)throw Error('PURGE_RESTORE_INCONSISTENT');
 for(const [userId,requestId] of seen){
  const checked=await auditDb.query('select * from private.restore_purge_audit($1::uuid[])',[[userId]]);
  const row=checked?.rows?.[0];
  if(checked?.rows?.length!==1||row.user_id!==userId||typeof row.auth_present!=='boolean'||typeof row.profile_present!=='boolean'||typeof row.pending_purge!=='boolean')throw Error('PURGE_RESTORE_AUDIT_INVALID');
  if(row.auth_present!==row.profile_present)throw Error('PURGE_RESTORE_INCONSISTENT');
  if(!row.auth_present&&!row.pending_purge)continue;
  const prepared=await restoreDb.query('select private.restore_begin_purge($1,$2) job',[userId,requestId]);
  const job=prepared?.rows?.[0]?.job;
  if(!job||job.type!=='account.purge'||!job.id||!job.leaseToken||!job.leaseUntil)throw Error('PURGE_RESTORE_STATE_INVALID');
  await runJob({db:workerDb,job});
 }
 return requireRestorePurgesComplete({db:auditDb,journal});
}
