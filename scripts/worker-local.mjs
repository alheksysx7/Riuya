import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import pg from 'pg';import {fixtureDraft} from '../src/worker/editorial.mjs';import {processSourceJob} from '../src/worker/source-fetch.mjs';import {processClusterJob} from '../src/worker/cluster.mjs';import {generateWithOllama} from '../src/worker/ollama.mjs';
const raw=readFileSync('.env.worker.local','utf8');const m=raw.match(/^RIUYA_WORKER_PASSWORD=([a-f0-9]{64})$/m);if(!m)throw Error('Ejecuta primero npm run worker:setup');
const client=new pg.Client({host:'127.0.0.1',port:54322,user:'riuya_worker_local',password:m[1],database:'postgres',connectionTimeoutMillis:5000});
const worker='local-'+randomUUID();let stopping=false;let activeController=null;
function stop(){stopping=true;activeController?.abort();}process.on('SIGINT',stop);process.on('SIGTERM',stop);
await client.connect();console.log('Worker local iniciado; procesa fuentes verificadas y propuestas ficticias.');
try{
 while(!stopping){
  const {rows}=await client.query('select private.claim_job($1, $2) job',[worker,60]);const job=rows[0].job;
  if(!job){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
  try{
   if(job.type==='draft.generate'&&job.payload?.fixtureId==='demo-v1'){
    const candidate=fixtureDraft({key:'f1',name:'Fuente ficticia',date:'2026-11-09',url:'https://example.org/noticia'});
    const complete=await client.query('select private.complete_fixture_draft($1,$2,$3::jsonb) ok',[job.id,job.leaseToken,JSON.stringify(candidate)]);
    if(!complete.rows[0].ok)console.log('Trabajo vencido; otro proceso podrá recuperarlo.');else console.log('Propuesta ficticia lista para revisión.');
   }else if(job.type==='draft.generate'&&job.payload?.mode==='ollama'){
    const q=await client.query('select private.ollama_job_info($1,$2) info',[job.id,job.leaseToken]);const info=q.rows[0].info;if(!info)throw Error('GENERATION_SOURCE_UNAVAILABLE');
    const controller=new AbortController();activeController=controller;let renewing=false;
    const timer=setInterval(()=>{if(renewing)return;renewing=true;client.query('select private.renew_job($1,$2,60) ok',[job.id,job.leaseToken]).then(r=>{if(!r.rows[0].ok)controller.abort();}).catch(()=>controller.abort()).finally(()=>{renewing=false;});},10000);
    try{
     const value=await generateWithOllama({source:info.source,title:info.title,model:process.env.RIUYA_OLLAMA_MODEL||'qwen3:8b',signal:controller.signal});
     const result=await client.query('select private.complete_ollama_draft($1,$2,$3::jsonb,$4,$5,$6) ok',[job.id,job.leaseToken,JSON.stringify(value.candidate),value.model,value.digest,value.attempts]);
     if(result.rows[0].ok)console.log('Propuesta de Ollama lista para revisión.');else console.log('Trabajo vencido o cancelado.');
    }finally{clearInterval(timer);activeController=null;}
   }else if(job.type==='source.fetch'){
    const count=await processSourceJob(client,job);console.log('Fuente procesada; elementos recibidos:',count);
   }else if(job.type==='event.cluster'){const count=await processClusterJob(client,job);console.log('Agrupaciones propuestas:',count);
   }else throw Error('UNSUPPORTED_JOB');
  }catch(e){
   const name=e instanceof Error?e.message:'WORKER_ERROR';
   const permanent=['UNSUPPORTED_JOB','SOURCE_UNAVAILABLE','URL_NOT_ALLOWED','PORT_NOT_ALLOWED','ADDRESS_NOT_ALLOWED','INVALID_FEED','INVALID_XML','SOURCE_HTTP_PERMANENT','CLUSTER_UNAVAILABLE','GENERATION_SOURCE_UNAVAILABLE','OLLAMA_FORMAT_INVALID','OLLAMA_MODEL_UNAVAILABLE'];
   const code=/^[A-Z0-9_]{1,64}$/.test(name)?name:'WORKER_ERROR';
   await client.query('select private.finish_job($1,$2,false,$3,$4)',[job.id,job.leaseToken,permanent.includes(code),code]);console.log('Trabajo no completado:',code);
  }
 }
}finally{await client.end();}
