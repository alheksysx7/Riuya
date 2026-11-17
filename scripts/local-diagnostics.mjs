// Solo lecturas agregadas: no se consultan identidades ni contenido de trabajos.
export async function collectDiagnostics(db){
 await db.query('begin isolation level repeatable read read only');
 try{
  await db.query("set local statement_timeout='5s'");
  const jobs=(await db.query(`select
   count(*) filter(where status='queued')::int as pendientes,
   count(*) filter(where status='queued' and available_at<=now())::int as disponibles,
   count(*) filter(where status='queued' and available_at<now()-interval '5 minutes')::int as atrasados,
   count(*) filter(where status='running')::int as en_ejecucion,
   count(*) filter(where status='running' and lease_until<now())::int as leases_vencidos,
   count(*) filter(where status='failed')::int as fallidos,
   coalesce(floor(extract(epoch from now()-min(available_at) filter(where status='queued' and available_at<=now()))),0)::int as espera_mas_antigua_segundos
   from private.jobs`)).rows[0];
  const other=(await db.query(`select
   (select count(*)::int from pg_catalog.pg_locks where not granted) as bloqueos_en_espera,
   (select count(*)::int from private.articles where status='withdrawn' and withdrawn_at>=now()-interval '24 hours') as retiradas_24h`)).rows[0];
  await db.query('commit');
  return {cola:jobs,bloqueosEnEspera:other.bloqueos_en_espera,noticiasRetiradas24h:other.retiradas_24h};
 }catch(error){await db.query('rollback').catch(()=>{});throw error;}
}
export function validateLocalTarget(status){
 if(status?.API_URL!=='http://127.0.0.1:54321'||typeof status.DB_URL!=='string')throw Error('LOCAL_TARGET_INVALID');
 let url;try{url=new URL(status.DB_URL);}catch{throw Error('LOCAL_TARGET_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='54322'||
  url.pathname!=='/postgres'||url.username!=='postgres'||url.search||url.hash)throw Error('LOCAL_TARGET_INVALID');
 return status.DB_URL;
}
