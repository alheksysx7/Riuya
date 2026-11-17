import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {runWorkerTick} from './worker-tick.mjs';
import {fixtureDraft} from './editorial.mjs';
import {processSourceJob} from './source-fetch.mjs';
import {processClusterJob} from './cluster.mjs';
import {generateWithOllama} from './ollama.mjs';
import {processLocalNotification,startNotificationScheduler} from './notification.mjs';

// La conexión y la habilitación de purga se deciden antes de entrar al bucle.
export async function runWorker({client,scheduler,connection,purgeEnabled,verify=async()=>{},prefix='local'}){
 const worker=prefix+'-'+randomUUID();let stopping=false,activeController=null,stopScheduler=()=>{};
 function stop(){stopping=true;activeController?.abort();}
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  await client.connect();await scheduler.connect();await verify(client);
  if(purgeEnabled){
   const {ensurePurgeWorkerReady}=await import('./purge-worker-readiness.mjs');
   const {verifyLocalPurgeReadiness}=await import('./purge-local.mjs');
   await ensurePurgeWorkerReady({db:client,verify:verifyLocalPurgeReadiness});
  }
  stopScheduler=startNotificationScheduler(scheduler,{beforeSchedule:()=>verify(scheduler),onError:()=>console.log(JSON.stringify({event:'worker.scheduler',status:'failed'}))});
  console.log(JSON.stringify({event:'worker.start',status:'started'}));
  while(!stopping){
   await verify(client);
   if(stopping)break;
   const worked=await runWorkerTick({client,worker,purgeEnabled,onError:()=>{},onEvent:event=>console.log(JSON.stringify(event)),processJob:async(job)=>{
   if(job.type==='draft.generate'&&job.payload?.fixtureId==='demo-v1'){
    const candidate=fixtureDraft({key:'f1',name:'Fuente ficticia',date:'2026-11-09',url:'https://example.org/noticia'});
    const complete=await client.query('select private.complete_fixture_draft($1,$2,$3::jsonb) ok',[job.id,job.leaseToken,JSON.stringify(candidate)]);
    if(!complete.rows[0].ok)return 'lease_lost';
   }else if(job.type==='draft.generate'&&job.payload?.mode==='ollama'){
    const q=await client.query('select private.ollama_job_info($1,$2) info',[job.id,job.leaseToken]);const info=q.rows[0].info;if(!info)throw Error('GENERATION_SOURCE_UNAVAILABLE');
    const controller=new AbortController();activeController=controller;let renewing=false;
    const timer=setInterval(()=>{if(renewing)return;renewing=true;client.query('select private.renew_job($1,$2,60) ok',[job.id,job.leaseToken]).then(r=>{if(!r.rows[0].ok)controller.abort();}).catch(()=>controller.abort()).finally(()=>{renewing=false;});},10000);
    try{
     const value=await generateWithOllama({source:info.source,title:info.title,model:process.env.RIUYA_OLLAMA_MODEL||'qwen3:8b',signal:controller.signal});
     const result=await client.query('select private.complete_ollama_draft($1,$2,$3::jsonb,$4,$5,$6) ok',[job.id,job.leaseToken,JSON.stringify(value.candidate),value.model,value.digest,value.attempts]);
     if(!result.rows[0].ok)return 'lease_lost';
    }finally{clearInterval(timer);activeController=null;}
   }else if(job.type==='source.fetch'){
    await processSourceJob(client,job);
   }else if(job.type==='event.cluster'){await processClusterJob(client,job);
   }else if(job.type==='notification.send'){await processLocalNotification(client,job);
   }else if(job.type==='account.purge'&&purgeEnabled){
    const {runLocalPurgeJob}=await import('./purge-local.mjs');
    const {runWithPurgeHeartbeat}=await import('./purge-heartbeat.mjs');
    await runWithPurgeHeartbeat({heart:new pg.Client(connection),job,run:()=>runLocalPurgeJob({db:client,job})});
   }else throw Error('UNSUPPORTED_JOB');
   }});
   if(!worked)await new Promise(resolve=>setTimeout(resolve,2000));
  }
 }finally{
  stopScheduler();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  await Promise.allSettled([client.end(),scheduler.end()]);
 }
}
