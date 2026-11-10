import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import pg from 'pg';
const m=readFileSync('.env.worker.local','utf8').match(/^RIUYA_WORKER_PASSWORD=([a-f0-9]{64})$/m);if(!m)throw Error('Worker no configurado');
const c=new pg.Client({host:'127.0.0.1',port:54322,user:'riuya_worker_local',password:m[1],database:'postgres'});
await c.connect();try{
 const r=await c.query(`select has_table_privilege(current_user,'private.jobs','select') as jobs,has_table_privilege(current_user,'private.profiles','select') as profiles,has_function_privilege(current_user,'private.claim_job(text,integer)','execute') as claim`);
 assert.equal(r.rows[0].jobs,false);assert.equal(r.rows[0].profiles,false);assert.equal(r.rows[0].claim,true);
 await assert.rejects(()=>c.query('select * from private.jobs'),e=>e.code==='42501');
 console.log('Z09 worker: rol limitado, sin acceso a tablas privadas: OK');
}finally{await c.end();}
