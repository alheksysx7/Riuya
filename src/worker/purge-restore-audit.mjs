import {loadPurgeIntents,loadCurrentPurgeIntents} from './purge-journal.mjs';

// Comprobación de solo lectura. El llamador debe mantener el tráfico detenido.
export async function auditRestoredPurges({db,journal}){
 const records=await loadPurgeIntents(journal);
 return auditRecords(db,records);
}

async function auditRecords(db,records){
 if(!db||typeof db.query!=='function')throw Error('PURGE_RESTORE_AUDIT_INVALID');
 const ids=[...new Set(records.map(record=>record.userId))];
 let remaining=0,cleared=0,inconsistent=0;
 for(let i=0;i<ids.length;i+=1000){
  const batch=ids.slice(i,i+1000);
  const result=await db.query('select * from private.restore_purge_audit($1::uuid[])',[batch]);
  const rows=result?.rows;
  if(!Array.isArray(rows)||rows.length!==batch.length)throw Error('PURGE_RESTORE_AUDIT_INVALID');
  const storageResult=await db.query('select * from private.restore_storage_present($1::uuid[])',[batch]);
  if(!Array.isArray(storageResult?.rows)||storageResult.rows.length!==batch.length)throw Error('PURGE_RESTORE_AUDIT_INVALID');
  const storage=new Map();
  for(const row of storageResult.rows){
   if(!batch.includes(row.user_id)||storage.has(row.user_id)||typeof row.storage_present!=='boolean')throw Error('PURGE_RESTORE_AUDIT_INVALID');
   storage.set(row.user_id,row.storage_present);
  }
  const pending=new Set(batch);
  for(const row of rows){
   if(!pending.delete(row.user_id)||typeof row.auth_present!=='boolean'||typeof row.profile_present!=='boolean'||typeof row.pending_purge!=='boolean')throw Error('PURGE_RESTORE_AUDIT_INVALID');
   if(row.auth_present&&row.profile_present)remaining++;
   else if(row.auth_present||row.profile_present||storage.get(row.user_id))inconsistent++;
   else if(row.pending_purge)remaining++;
   else cleared++;
  }
  if(pending.size)throw Error('PURGE_RESTORE_AUDIT_INVALID');
 }
 return {recorded:ids.length,remaining,cleared,inconsistent,ready:remaining===0&&inconsistent===0};
}

// La integración de arranque/restauración deberá invocar esta función antes
// de abrir tráfico; este módulo por sí solo no controla servicios de red.
export async function inspectRestorePurges(options){
 const records=await loadCurrentPurgeIntents(options.journal);
 const report=await auditRecords(options.db,records);
 const after=await loadCurrentPurgeIntents(options.journal);
 if(JSON.stringify(records)!==JSON.stringify(after))throw Error('PURGE_RESTORE_JOURNAL_CHANGED');
 return report;
}

// Ante bajas registradas, un objeto sin propietario verificable requiere revisión.
export async function hasUnattributedRestoreStorage({db,journal}){
 const records=await loadCurrentPurgeIntents(journal);
 if(!records.length)return false;
 const result=await db.query('select private.restore_unattributed_storage_present() present',[]);
 if(result?.rows?.length!==1||typeof result.rows[0].present!=='boolean')throw Error('PURGE_RESTORE_AUDIT_INVALID');
 return result.rows[0].present;
}

export async function requireRestorePurgesComplete(options){
 if(await hasUnattributedRestoreStorage(options))throw Error('PURGE_RESTORE_UNATTRIBUTED_STORAGE');
 const report=await inspectRestorePurges(options);
 if(await hasUnattributedRestoreStorage(options))throw Error('PURGE_RESTORE_UNATTRIBUTED_STORAGE');
 if(!report.ready)throw Error('PURGE_RESTORE_NOT_READY');
 return report;
}
