import assert from 'node:assert/strict';
import {workerServiceConfig,verifyWorkerServiceRole} from '../src/worker/worker-service-config.mjs';

const base={RIUYA_WORKER_ENABLED:'1',RIUYA_WORKER_DATABASE_URL:'postgresql://worker:fixture@database.example.invalid/app?sslmode=verify-full'};
assert.equal(workerServiceConfig(base).connectionString,base.RIUYA_WORKER_DATABASE_URL);
const lab={...base,RIUYA_WORKER_LAB_PLAINTEXT:'1',RIUYA_WORKER_DATABASE_URL:'postgresql://worker:fixture@supabase_db_riuya_z11_lab_0123456789abcdefabcd:5432/postgres'};
assert.equal(workerServiceConfig(lab).connectionString,lab.RIUYA_WORKER_DATABASE_URL);
for(const bad of [
 {...base,RIUYA_WORKER_ENABLED:'0'}, {...base,RIUYA_PURGE_ENABLED:'1'}, {...base,NOTIFICATION_TRANSPORT:'push'},
 {...base,RIUYA_WORKER_DATABASE_URL:'postgresql://worker:fixture@database.example.invalid/app'},
 {...base,RIUYA_WORKER_DATABASE_URL:'postgresql://worker:fixture@database.example.invalid/app?sslmode=require'},
 {...base,RIUYA_WORKER_DATABASE_URL:base.RIUYA_WORKER_DATABASE_URL+'&host=elsewhere'},
 {...lab,RIUYA_WORKER_DATABASE_URL:'postgresql://worker:fixture@supabase_db_app:5432/postgres'},
 {...base,RIUYA_WORKER_DATABASE_URL:'https://worker:fixture@database.example.invalid/app?sslmode=verify-full'}
])assert.throws(()=>workerServiceConfig(bad),/WORKER_CONFIG_INVALID/);
const client=rows=>({query:async()=>({rows})});
await verifyWorkerServiceRole(client([{allowed:true,purge:false,elevated:false,direct_data:false,filtered_claim:true,unfiltered_claim:false,missing_function:false,extra_definer:false}]));
for(const rows of [[],[{allowed:false,purge:false,elevated:false,direct_data:false,filtered_claim:true,unfiltered_claim:false,missing_function:false,extra_definer:false}],[{allowed:true,purge:true,elevated:false,direct_data:false,filtered_claim:true,unfiltered_claim:false,missing_function:false,extra_definer:false}],[{allowed:true,purge:false,elevated:true,direct_data:false,filtered_claim:true,unfiltered_claim:false,missing_function:false,extra_definer:false}],[{allowed:true,purge:false,elevated:false,direct_data:true,filtered_claim:true,unfiltered_claim:false,missing_function:false,extra_definer:false}],[{allowed:true,purge:false,elevated:false,direct_data:false,filtered_claim:false,unfiltered_claim:false,missing_function:false,extra_definer:false}],[{allowed:true,purge:false,elevated:false,direct_data:false,filtered_claim:true,unfiltered_claim:true,missing_function:false,extra_definer:false}],[{allowed:true,purge:false,elevated:false,direct_data:false,filtered_claim:true,unfiltered_claim:false,missing_function:true,extra_definer:false}],[{allowed:true,purge:false,elevated:false,direct_data:false,filtered_claim:true,unfiltered_claim:false,missing_function:false,extra_definer:true}]])
 await assert.rejects(()=>verifyWorkerServiceRole(client(rows)),/WORKER_ROLE_INVALID/);
console.log('Z12 worker: configuración y rol restringido: OK');
