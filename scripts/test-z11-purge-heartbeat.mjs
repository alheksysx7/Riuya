import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runWithPurgeHeartbeat} from '../src/worker/purge-heartbeat.mjs';

const job={id:randomUUID(),leaseToken:randomUUID(),leaseUntil:'old'};
let start,release;
const started=new Promise(resolve=>{start=resolve;}),gate=new Promise(resolve=>{release=resolve;});
let calls=0,finished=false,closed=false;
const heart={
 async connect(){},
 async query(_sql,args){assert.deepEqual(args,[job.id,job.leaseToken,60]);calls++;start();await gate;finished=true;return {rows:[{ok:true}]};},
 async end(){assert.equal(finished,true);closed=true;}
};
const result=runWithPurgeHeartbeat({heart,job,intervalMs:5,run:async()=>{await started;setTimeout(release,30);return 'done';}});
assert.equal(await result,'done');
assert.equal(calls,1);
assert.equal(closed,true);
assert.notEqual(job.leaseUntil,'old');

let closedAfterFailure=false;
await assert.rejects(()=>runWithPurgeHeartbeat({heart:{async connect(){},async query(){throw Error('RENEW_FAILED');},async end(){closedAfterFailure=true;}},job,intervalMs:5,run:async()=>{await new Promise(resolve=>setTimeout(resolve,20));throw Error('PROCESS_FAILED');}}),/PROCESS_FAILED/);
assert.equal(closedAfterFailure,true);
let observedLease=0,notify;
const observed=new Promise(resolve=>{notify=resolve;});
const restoreJob={id:randomUUID(),leaseToken:randomUUID()};
await runWithPurgeHeartbeat({heart:{async connect(){},async query(_sql,args){observedLease=args[2];notify();return {rows:[{ok:true}]};},async end(){}},
 job:restoreJob,intervalMs:5,leaseSeconds:600,run:async()=>{await observed;await new Promise(resolve=>setTimeout(resolve,0));}});
assert.equal(observedLease,600);
assert.ok(new Date(restoreJob.leaseUntil).getTime()>Date.now()+580000);
console.log('Z11 worker: renovación sin solapamiento y cierre ante fallos: OK');
