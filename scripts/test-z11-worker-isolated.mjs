import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {runWorkerTick} from '../src/worker/worker-tick.mjs';

const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const name='riuya_z11_isolated_'+randomUUID().replaceAll('-','');
if(!/^riuya_z11_isolated_[a-f0-9]{32}$/.test(name))throw Error('TEST_DB_INVALID');
const base=new pg.Client({connectionString:status.DB_URL}),target=new URL(status.DB_URL);target.pathname='/'+name;
const isolated=new pg.Client({connectionString:target.toString()});let created=false,baseConnected=false,isolatedConnected=false;
try{
 await base.connect();baseConnected=true;
 await base.query('CREATE DATABASE "'+name+'" TEMPLATE template0');created=true;
 await isolated.connect();isolatedConnected=true;
 const identity=await isolated.query('select current_database() name');
 if(identity.rows[0].name!==name)throw Error('TEST_DB_INVALID');
 await isolated.query(`create schema private;
 create table private.jobs(
 id uuid primary key default gen_random_uuid(),job_type text not null,payload jsonb not null default '{}',
 dedupe_key text unique not null,status text not null default 'queued',attempts int not null default 0,
 max_attempts int not null default 4,available_at timestamptz not null default now(),
 locked_by text,lease_token uuid,lease_until timestamptz,last_error text,created_by uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
 alter table private.jobs enable row level security;
 grant usage on schema private to riuya_job_executor;
 grant select,insert,update on private.jobs to riuya_job_executor;
 create policy fixture_jobs on private.jobs for all to riuya_job_executor using(true) with check(true);`);
 const finishMigration=await readFile('supabase/migrations/20261109200000_z09_error_codes.sql','utf8');
 await isolated.query('begin');await isolated.query(finishMigration);await isolated.query('commit');
 const migration=await readFile('supabase/migrations/20261111170000_z11_claim_filtered.sql','utf8');
 await isolated.query('begin');await isolated.query(migration);await isolated.query('set local role riuya_job_executor');await isolated.query('grant execute on function private.claim_job_filtered(text,integer,boolean) to postgres');await isolated.query('reset role');await isolated.query('commit');
 const regular=randomUUID(),purge=randomUUID();
 await isolated.query("insert into private.jobs(id,job_type,payload,dedupe_key,available_at) values($1,'source.fetch','{}',$2,now()-interval '1 hour'),($3,'account.purge','{}',$4,now()-interval '2 hours')",[regular,'z11-normal-'+regular,purge,'z11-purge-'+purge]);
 const processed=[];
 const processJob=async job=>{
  processed.push([job.id,job.type]);
  await isolated.query("update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null where id=$1 and lease_token=$2",[job.id,job.leaseToken]);
 };
 assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:false,processJob}),true);
 assert.deepEqual(processed,[[regular,'source.fetch']]);
 assert.equal((await isolated.query('select status from private.jobs where id=$1',[purge])).rows[0].status,'queued');
 assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:false,processJob}),false);
 assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:true,processJob}),true);
 assert.deepEqual(processed,[[regular,'source.fetch'],[purge,'account.purge']]);
 assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:true,processJob}),false);
 const failing=randomUUID(),messages=[];
 await isolated.query("insert into private.jobs(id,job_type,payload,dedupe_key) values($1,'account.purge','{}',$2)",[failing,'z11-failure-'+failing]);
 assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:true,processJob:async()=>{throw Error('texto privado de prueba');},onError:(...args)=>messages.push(args)}),true);
 let failure=await isolated.query('select status,last_error,attempts,available_at>now() delayed from private.jobs where id=$1',[failing]);
 assert.deepEqual(failure.rows[0],{status:'queued',last_error:'WORKER_ERROR',attempts:1,delayed:true});
 assert.deepEqual(messages,[['Trabajo no completado:','WORKER_ERROR']]);
 assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:true,processJob}),false);
 for(let attempt=2;attempt<=4;attempt++){
  await isolated.query("update private.jobs set available_at=now()-interval '1 second' where id=$1",[failing]);
  assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:true,processJob:async()=>{throw Error('PURGE_STORAGE_DELETE_FAILED');},onError:()=>{}}),true);
  failure=await isolated.query('select status,last_error,attempts from private.jobs where id=$1',[failing]);
  assert.deepEqual(failure.rows[0],{status:attempt===4?'failed':'queued',last_error:'PURGE_STORAGE_DELETE_FAILED',attempts:attempt});
 }
 assert.equal(await runWorkerTick({client:isolated,worker:'fixture',purgeEnabled:true,processJob}),false);
 console.log('Z11 worker: cola aislada, filtro, reintentos y fallo definitivo con funciones reales: OK');
}finally{
 if(isolatedConnected)await isolated.end().catch(()=>{});
 if(created){
  if(!/^riuya_z11_isolated_[a-f0-9]{32}$/.test(name))throw Error('TEST_DB_INVALID');
  await base.query('DROP DATABASE "'+name+'"');
 }
 if(baseConnected)await base.end().catch(()=>{});
}
