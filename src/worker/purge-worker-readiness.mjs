// Se comprueba antes de reclamar trabajos. No habilita roles ni modifica la cola.
export async function ensurePurgeWorkerReady({db,verify}){
 if(!db||typeof db.query!=='function'||typeof verify!=='function')throw Error('PURGE_WORKER_CONFIG_INVALID');
 const rights=await db.query("select has_function_privilege(current_user,'private.begin_account_purge(uuid,uuid)','execute') allowed");
 if(rights?.rows?.[0]?.allowed!==true)throw Error('PURGE_WORKER_NOT_AUTHORIZED');
 await verify();
}
