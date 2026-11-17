import assert from 'node:assert/strict';
import {runWorker} from '../src/worker/worker-runtime.mjs';

function fake({failConnect=false,claim=false}={}){
 const calls=[];
 return {calls,async connect(){calls.push('connect');if(failConnect)throw Error('CONNECT_FAILED');},
  async end(){calls.push('end');},
  async query(sql){
   calls.push(sql);
   if(sql.includes('claim_job_filtered')){
    assert.equal(claim,true);queueMicrotask(()=>process.emit('SIGTERM'));
    return {rows:[{job:null}]};
   }
   return {rows:[]};
  }};
}
{
 const client=fake(),scheduler=fake({failConnect:true});
 await assert.rejects(()=>runWorker({client,scheduler,connection:{},purgeEnabled:false}),/CONNECT_FAILED/);
 assert(client.calls.includes('end'));assert(scheduler.calls.includes('end'));
 assert(!client.calls.some(x=>x.includes('claim_job_filtered')));
}
{
 const client=fake(),scheduler=fake();
 await assert.rejects(()=>runWorker({client,scheduler,connection:{},purgeEnabled:false,verify:async()=>{throw Error('VERIFY_FAILED');}}),/VERIFY_FAILED/);
 assert(client.calls.includes('end'));assert(scheduler.calls.includes('end'));
 assert(!client.calls.some(x=>x.includes('claim_job_filtered')));
}
{
 const client=fake(),scheduler=fake();let checks=0;
 await assert.rejects(()=>runWorker({client,scheduler,connection:{},purgeEnabled:false,
  verify:async value=>{if(value===client&&++checks===2)throw Error('ROLE_CHANGED');}}),/ROLE_CHANGED/);
 assert(client.calls.includes('end'));assert(scheduler.calls.includes('end'));
 assert(!client.calls.some(x=>x.includes('claim_job_filtered')));
}
{
 const client=fake({claim:true}),scheduler=fake();
 await runWorker({client,scheduler,connection:{},purgeEnabled:false});
 assert(client.calls.includes('end'));assert(scheduler.calls.includes('end'));
}
console.log('Z12 worker: errores de inicio y parada ordenada: OK');
