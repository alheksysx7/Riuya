// Diagnóstico conservador de superficies locales conocidas; no bloquea tráfico.
const active=state=>typeof state==='string'&&!['exited','created','dead'].includes(state);
const exposedServices=['supabase_kong_app','supabase_rest_app','supabase_realtime_app','supabase_studio_app','supabase_pg_meta_app'];
export function evaluateRestoreIsolation(snapshot){
 if(!snapshot||!snapshot.containers||typeof snapshot.containers!=='object'||!Array.isArray(snapshot.dbBindings)||
    typeof snapshot.appPortOpen!=='boolean'||typeof snapshot.apiPortOpen!=='boolean'||typeof snapshot.workerRunning!=='boolean'||
    typeof snapshot.authPublished!=='boolean'||typeof snapshot.storagePublished!=='boolean')throw Error('RESTORE_ISOLATION_UNKNOWN');
 const blockers=[];
 if(snapshot.containers.supabase_db_app!=='running')blockers.push('BASE_NO_DISPONIBLE');
 for(const service of exposedServices)if(active(snapshot.containers[service]))blockers.push('SERVICIO_ABIERTO:'+service);
 if(snapshot.appPortOpen)blockers.push('PUERTO_APP_ABIERTO');
 if(snapshot.apiPortOpen)blockers.push('PUERTO_API_ABIERTO');
 if(snapshot.workerRunning)blockers.push('WORKER_ACTIVO');
 if(snapshot.authPublished)blockers.push('AUTH_PUBLICADO');
 if(snapshot.storagePublished)blockers.push('STORAGE_PUBLICADO');
 if(snapshot.dbBindings.length!==1||snapshot.dbBindings[0]?.HostIp!=='127.0.0.1'||snapshot.dbBindings[0]?.HostPort!=='54322')blockers.push('BASE_PUBLICADA_O_NO_VERIFICABLE');
 return {blocked:blockers.length>0,blockers};
}
