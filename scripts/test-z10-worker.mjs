import assert from 'node:assert/strict';import {processLocalNotification,startNotificationScheduler} from '../src/worker/notification.mjs';
let calls=[];const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{ok:true}]};}};
await processLocalNotification(client,{id:'job-id',leaseToken:'lease-id'});assert.deepEqual(calls[0].args,['job-id','lease-id']);
await assert.rejects(()=>processLocalNotification({query:async()=>({rows:[{ok:false}]})},{id:'job',leaseToken:'lease'}),/NOTIFICATION_LEASE_EXPIRED/);
calls=[];const stop=startNotificationScheduler(client);await new Promise(resolve=>setImmediate(resolve));stop();assert.equal(calls.length,1);assert.match(calls[0].sql,/schedule_notifications/);
let errors=0;const stopError=startNotificationScheduler({query:async()=>{throw Error('TEST');}},{onError:()=>errors++});await new Promise(resolve=>setImmediate(resolve));stopError();assert.equal(errors,1);
console.log('Z10 worker: agenda, captura local y lease inválido: OK');
