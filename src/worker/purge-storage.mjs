import {isScopedPurgeStorage} from './purge-storage-auth.mjs';

// Las entradas deben provenir de una consulta autorizada por el lease de purga.
// La ausencia de error no sustituye la comprobación posterior en storage.objects.
export async function removePurgeObjects(storage,entries){
 if(!storage||typeof storage.from!=='function'||!Array.isArray(entries))throw Error('PURGE_STORAGE_INVALID');
 const groups=new Map();
 for(const entry of entries){
  if(!entry||typeof entry.bucket_id!=='string'||!entry.bucket_id||typeof entry.name!=='string'||!entry.name||entry.name.includes('\0')||entry.name.split('/').some(part=>part==='..')||typeof entry.is_versioned!=='boolean'||typeof entry.is_delete_marker!=='boolean'||typeof entry.version!=='string'||!entry.version||entry.version.length>512||entry.version.includes('\0'))throw Error('PURGE_STORAGE_UNSUPPORTED');
  if(!groups.has(entry.bucket_id))groups.set(entry.bucket_id,new Map());
  groups.get(entry.bucket_id).set(JSON.stringify([entry.name,entry.version]),{path:entry.name,versionId:entry.version});
 }
 for(const [bucket,paths] of groups){
  const names=[...paths.values()];
  for(let i=0;i<names.length;i+=100){
   const {error}=await storage.from(bucket).remove(names.slice(i,i+100));
   if(error)throw Error('PURGE_STORAGE_DELETE_FAILED');
  }
 }
}

// El worker solo debe proporcionar un cliente de Storage limitado al lease.
export async function clearPurgeStorage({db,storage,storageFactory,job}){
 if(!db||typeof db.query!=='function'||!job?.id||!job?.leaseToken||(!isScopedPurgeStorage(storage,job)&&typeof storageFactory!=='function'))throw Error('PURGE_STORAGE_INVALID');
 const inventory=async()=>{
  const result=await db.query('select private.purge_storage_inventory($1,$2) inventory',[job.id,job.leaseToken]);
  const rows=result?.rows?.[0]?.inventory;
  if(!Array.isArray(rows)||rows.length>100)throw Error('PURGE_STORAGE_INVALID');
  return rows;
 };
 for(let batch=0;batch<1000;batch++){
  const before=await inventory();
  if(before.length===0)return;
  const verified=await inventory();
  if(JSON.stringify(before)!==JSON.stringify(verified))throw Error('PURGE_STORAGE_CHANGED');
  const batchStorage=storageFactory?await storageFactory():storage;
  if(!isScopedPurgeStorage(batchStorage,job))throw Error('PURGE_STORAGE_INVALID');
  await removePurgeObjects(batchStorage,verified);
  const after=await inventory();
  if(JSON.stringify(before)===JSON.stringify(after))throw Error('PURGE_STORAGE_NOT_REMOVED');
  if(after.length===0)return;
 }
 throw Error('PURGE_STORAGE_LIMIT');
}
