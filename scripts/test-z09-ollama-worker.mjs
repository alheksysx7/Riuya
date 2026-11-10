import http from 'node:http';import {spawn,execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {fixtureDraft} from '../src/worker/editorial.mjs';
const sql=q=>execFileSync('docker',['exec','-i','supabase_db_app','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
if(sql("select count(*) from private.jobs where status in ('queued','running')")!=='0')throw Error('Hay trabajos activos; prueba omitida.');
const u=randomUUID(),sid=randomUUID(),iid=randomUUID(),j=randomUUID(),k=randomUUID();let calls=0;let responseAborted=false;let worker;
const source={key:'f1',name:'SIMULACIÓN fuente',date:'2026-11-09',url:'https://example.org/fixture-'+iid};
const server=http.createServer((req,res)=>{
 let raw='';req.on('data',x=>raw+=x);req.on('end',()=>{
  if(req.url==='/api/tags'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({models:[{name:'qwen3:8b',digest:'a'.repeat(64)}]}));return;}
  if(req.url!=='/api/generate'){res.writeHead(404);res.end();return;}
  const payload=JSON.parse(raw);assert.equal(payload.model,'qwen3:8b');assert.equal(payload.format.type,'object');assert(payload.prompt.includes('SIMULACIÓN'));
  calls++;if(calls===1){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({done:true,response:JSON.stringify(fixtureDraft(source))}));return;}
  res.on('close',()=>{if(!res.writableFinished)responseAborted=true;});const timer=setTimeout(()=>{if(!res.destroyed){res.writeHead(500);res.end();}},20000);timer.unref();
 });
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(11434,'127.0.0.1',resolve);});
try{
 sql(`insert into auth.users(id,email) values('${u}','z09-${u}@example.invalid');insert into private.profiles(id) values('${u}');insert into private.user_roles(user_id,role) values('${u}','editor');insert into private.sources(id,name,domain,source_type,base_url,verified,is_active,usage_policy,verified_by) values('${sid}','SIMULACIÓN fuente','example.org','rss','https://example.org/feed',true,true,'Solo pruebas','${u}');insert into private.source_items(id,source_id,canonical_url,title,external_date) values('${iid}','${sid}','${source.url}','SIMULACIÓN noticia ficticia','2026-11-09T12:00:00Z');insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values('${j}','draft.generate',jsonb_build_object('mode','ollama','itemId','${iid}'),'z09-test-${j}','${u}');`);
 worker=spawn(process.execPath,['scripts/worker-local.mjs'],{stdio:'ignore',windowsHide:true,env:{...process.env,RIUYA_OLLAMA_MODEL:'qwen3:8b'}});
 let state='';for(let t=0;t<20;t++){state=sql(`select status from private.jobs where id='${j}'`);if(state==='succeeded'||state==='failed')break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(state,'succeeded');assert.equal(sql(`select count(*) from private.generation_runs where job_id='${j}' and provider='ollama' and model_digest=repeat('a',64)`),'1');
 sql(`insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values('${k}','draft.generate',jsonb_build_object('mode','ollama','itemId','${iid}'),'z09-test-${k}','${u}');`);
 for(let t=0;t<20&&calls<2;t++)await new Promise(r=>setTimeout(r,500));assert.equal(calls,2);
 const cancel=sql(`begin;select set_config('request.jwt.claim.sub','${u}',true);select api.cancel_editor_job('${k}')->>'status';commit;`);assert(cancel.includes('cancelled'));
 for(let t=0;t<28&&!responseAborted;t++)await new Promise(r=>setTimeout(r,500));
 assert(responseAborted);assert.equal(sql(`select count(*) from private.generation_runs where job_id='${k}'`),'0');
 console.log('Z09 worker: Ollama local simulado, digest y cancelación en curso: OK');
}finally{
 if(worker)worker.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
 sql(`delete from private.generation_runs where job_id in ('${j}','${k}');delete from private.jobs where id in ('${j}','${k}') and dedupe_key in ('z09-test-${j}','z09-test-${k}');delete from private.source_items where id='${iid}' and source_id='${sid}';delete from private.sources where id='${sid}' and name='SIMULACIÓN fuente';delete from private.user_roles where user_id='${u}';delete from private.profiles where id='${u}';delete from auth.users where id='${u}';`);
}
