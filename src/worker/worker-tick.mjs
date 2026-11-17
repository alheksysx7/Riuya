import {randomUUID} from 'node:crypto';
// Un ciclo de cola; la conexión y el procesador determinan el entorno.
export async function runWorkerTick({client,worker,purgeEnabled,processJob,onError=console.log,onEvent=()=>{}}){
 const {rows}=await client.query('select private.claim_job_filtered($1, $2, $3) job',[worker,60,purgeEnabled]);
 const job=rows[0].job;
 if(!job)return false;
 const started=performance.now(),traceId=randomUUID();
 const emit=event=>{try{onEvent(event);}catch{/* La telemetría no cambia el resultado del trabajo. */}};
 const types=['draft.generate','source.fetch','event.cluster','notification.send','account.purge'];
 const type=types.includes(job.type)?job.type:'unknown';
 try{const result=await processJob(job);emit({event:'worker.job',traceId,type,status:result==='lease_lost'?'lease_lost':'completed',durationMs:Math.round(performance.now()-started)});}
 catch(e){
  const name=e instanceof Error?e.message:'WORKER_ERROR';
  const permanent=['UNSUPPORTED_JOB','SOURCE_UNAVAILABLE','URL_NOT_ALLOWED','PORT_NOT_ALLOWED','ADDRESS_NOT_ALLOWED','INVALID_FEED','INVALID_XML','SOURCE_HTTP_PERMANENT','CLUSTER_UNAVAILABLE','GENERATION_SOURCE_UNAVAILABLE','OLLAMA_FORMAT_INVALID','OLLAMA_MODEL_UNAVAILABLE'];
  const code=/^[A-Z0-9_]{1,64}$/.test(name)?name:'WORKER_ERROR';
  await client.query('select private.finish_job($1,$2,false,$3,$4)',[job.id,job.leaseToken,permanent.includes(code),code]);
  onError('Trabajo no completado:',code);
  emit({event:'worker.job',traceId,type,status:'failed',code:permanent.includes(code)?code:'WORKER_ERROR',durationMs:Math.round(performance.now()-started)});
 }
 return true;
}
