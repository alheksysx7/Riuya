import assert from 'node:assert/strict';
import {runWorkerTick} from '../src/worker/worker-tick.mjs';

const secret='JWT_PASSWORD_PRIVATE_TEXT';
async function run({type='source.fetch',failure,emitFailure=false,result}={}){
 const events=[],queries=[];
 const client={query:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.includes('claim_job_filtered'))return {rows:[{job:{id:secret,leaseToken:secret,type,payload:{secret}}}]};
  return {rows:[{ok:true}]};
 }};
 await runWorkerTick({client,worker:'test',purgeEnabled:false,processJob:async()=>{if(failure)throw Error(failure);return result;},
  onError:()=>{},onEvent:event=>{events.push(event);if(emitFailure)throw Error('output unavailable');}});
 return {events,queries};
}
const success=await run();
assert.equal(success.events[0].status,'completed');
assert.equal(success.events[0].type,'source.fetch');
assert.match(success.events[0].traceId,/^[0-9a-f-]{36}$/);
assert(Number.isInteger(success.events[0].durationMs));
assert(!JSON.stringify(success.events).includes(secret));
const failed=await run({type:secret,failure:secret});
assert.equal(failed.events[0].status,'failed');
assert.equal(failed.events[0].type,'unknown');
assert.equal(failed.events[0].code,'WORKER_ERROR');
assert(!JSON.stringify(failed.events).includes(secret));
assert.equal(failed.queries.filter(x=>x.sql.includes('finish_job')).length,1);
assert.equal((await run({result:'lease_lost'})).events[0].status,'lease_lost');
assert.equal((await run({emitFailure:true})).queries.filter(x=>x.sql.includes('finish_job')).length,0);
console.log('Z12 eventos del worker: estado, duración y privacidad OK');
