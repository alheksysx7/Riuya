import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {ensurePurgeWorkerReady} from '../src/worker/purge-worker-readiness.mjs';
let checks=0;
const forbidden={async query(){return{rows:[{allowed:false}]}}};
await assert.rejects(()=>ensurePurgeWorkerReady({db:forbidden,verify:async()=>{checks++;}}),/PURGE_WORKER_NOT_AUTHORIZED/);
assert.equal(checks,0);
const permitted={async query(){return{rows:[{allowed:true}]}}};
await assert.rejects(()=>ensurePurgeWorkerReady({db:permitted,verify:async()=>{throw Error('PURGE_JOURNAL_CORRUPT')}}),/PURGE_JOURNAL_CORRUPT/);
await ensurePurgeWorkerReady({db:permitted,verify:async()=>{checks++;}});
assert.equal(checks,1);
const m=readFileSync('.env.worker.local','utf8').match(/^RIUYA_WORKER_PASSWORD=([a-f0-9]{64})$/m);
if(!m)throw Error('Worker no configurado');
const db=new pg.Client({host:'127.0.0.1',port:54322,user:'riuya_worker_local',password:m[1],database:'postgres',connectionTimeoutMillis:5000});
await db.connect();
try{
 await assert.rejects(()=>ensurePurgeWorkerReady({db,verify:async()=>{throw Error('NO_DEBERIA_LEER_CONFIGURACION')}}),/PURGE_WORKER_NOT_AUTHORIZED/);
 const rights=await db.query("select pg_has_role(current_user,'riuya_purge_worker_client','member') as purge_member");
 assert.equal(rights.rows[0].purge_member,false);
 console.log('Z11 worker: autorización y configuración verificadas antes de reclamar: OK');
}finally{await db.end();}
