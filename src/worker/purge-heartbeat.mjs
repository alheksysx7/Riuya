// La conexión de renovación es independiente de la que procesa el trabajo.
export async function runWithPurgeHeartbeat({heart,job,run,intervalMs=10000,leaseSeconds=60}){
 if(!heart||typeof heart.connect!=='function'||typeof heart.query!=='function'||typeof heart.end!=='function'||typeof run!=='function'||!job?.id||!job?.leaseToken||!Number.isSafeInteger(intervalMs)||intervalMs<1||!Number.isSafeInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>600)throw Error('PURGE_HEARTBEAT_INVALID');
 await heart.connect();
 let renewing=false,pending=null;
 const timer=setInterval(()=>{
  if(renewing)return;
  renewing=true;
  pending=heart.query('select private.renew_job($1,$2,$3) ok',[job.id,job.leaseToken,leaseSeconds])
   .then(r=>{if(r.rows[0]?.ok)job.leaseUntil=new Date(Date.now()+(leaseSeconds-5)*1000).toISOString();})
   .catch(()=>null).finally(()=>{renewing=false;});
 },intervalMs);
 try{return await run();}
 finally{clearInterval(timer);if(pending)await pending;await heart.end();}
}
