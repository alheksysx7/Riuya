import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

// Exclusivo del proyecto Supabase temporal; el proceso no puede conectarse a la cola habitual.
export async function probeLabEditorial({status,dir,setupLabWorker}){
 const api=new URL(status.API_URL),dbUrl=new URL(status.DB_URL);
 if(api.hostname!=='127.0.0.1'||api.port==='54321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port==='54322'||typeof setupLabWorker!=='function')throw Error('LAB_SCOPE_INVALID');
 const db=new pg.Client({connectionString:status.DB_URL}),password=randomBytes(32).toString('hex');
 const user=randomUUID(),source=randomUUID(),job=randomUUID(),working=join(dir,'editorial-process');
 await mkdir(working);
 await writeFile(join(working,'.env.worker.local'),'RIUYA_WORKER_PASSWORD='+password+'\n',{flag:'wx'});
 await setupLabWorker(password);
 await db.connect();let child;
 try{
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running')")).rows[0].n,0);
  await db.query("insert into auth.users(id,email) values($1,$2)",[user,'z12-editor-'+randomUUID()+'@example.invalid']);
  await db.query('insert into private.profiles(id) values($1)',[user]);
  await db.query("insert into private.user_roles(user_id,role) values($1,'editor')",[user]);
  await db.query("insert into private.sources(id,name,domain,source_type,base_url,verified,is_active,usage_policy,verified_by) values($1,'SIMULACIÓN fuente','fixtures.example.invalid','rss','https://fixtures.example.invalid/feed',true,true,'Solo pruebas',$2)",[source,user]);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'source.fetch',jsonb_build_object('sourceId',$2::text,'sourceVersion',1),$3,$4)",[job,source,'z12-lab-'+job,user]);
  const workerUrl=new URL(status.DB_URL);workerUrl.username='riuya_worker_local';workerUrl.password=password;
  const entry=resolve('scripts/worker-local.mjs'),preload=resolve('scripts/probe-z11-worker-preload.mjs'),network=resolve('scripts/test-z09-network-preload.mjs');
  child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'--import',pathToFileURL(network).href,entry],{
   cwd:working,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,RIUYA_LAB_APP_ENTRY:entry,
    RIUYA_LAB_WORKER_DB:workerUrl.toString(),RIUYA_LAB_API:status.API_URL,RIUYA_PURGE_ENABLED:'0',NOTIFICATION_TRANSPORT:'local'}});
  let exited=false;const exit=new Promise(resolve=>child.on('exit',code=>{exited=true;resolve(code);}));
  let done=false;
  for(let i=0;i<100&&!done&&!exited;i++){
   done=(await db.query("select exists(select 1 from private.jobs where id=$1 and status='succeeded') and exists(select 1 from private.jobs where job_type='event.cluster' and payload->>'sourceJobId'=$1::text and status='succeeded') ok",[job])).rows[0].ok;
   if(!done)await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(done,true,'LAB_EDITORIAL_PROCESS_FAILED');
  assert.equal((await db.query('select count(*)::int n from private.source_items where source_id=$1',[source])).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from private.source_items where source_id=$1 and event_id is not null',[source])).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from private.source_group_proposals g join private.source_items a on a.id=g.item_a join private.source_items b on b.id=g.item_b where a.source_id=$1 and b.source_id=$1 and g.status='proposed'",[source])).rows[0].n,1);
  child.send('stop');const code=await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('LAB_EDITORIAL_STOP_TIMEOUT')),7000))]);
  assert.equal(code,0);child=null;
  console.log('Z12 laboratorio: worker editorial, fuente ficticia y agrupación sin publicación: OK');
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  await db.end();
 }
}
