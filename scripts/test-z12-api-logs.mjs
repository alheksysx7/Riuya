import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {observeApi} from '../src/lib/api-observability.ts';
import {createMetrics,watchStream} from './metrics-local.mjs';
import {PassThrough} from 'node:stream';

const captured=[],original=console.log,secret='SENSITIVE_COOKIE_TOKEN_TEST_123';
console.log=value=>captured.push(value);
try{
 const response=Response.json({secret},{status:418,headers:{'Cache-Control':'no-store'}});
 assert.equal(await observeApi('/api/v1/news','GET',async()=>response),response);
 await assert.rejects(observeApi('/api/v1/news','GET',async()=>{throw Error(secret);}),{message:secret});
 assert.deepEqual(captured.map(x=>JSON.parse(x).status),[418,500]);
 assert(!captured.join('').includes(secret));
 console.log=()=>{throw Error('log unavailable');};
 assert.equal(await observeApi('/api/v1/news','GET',async()=>response),response);
}finally{console.log=original;}

const reservation=createServer();
await new Promise((resolve,reject)=>reservation.once('error',reject).listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
let output='',child;
try{
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{
  cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,RIUYA_ENABLE_ACCOUNT_DELETION:'0'}});
 child.stdout.on('data',chunk=>{output+=chunk.toString();});
 child.stderr.on('data',chunk=>{output+=chunk.toString();});
 const origin='http://127.0.0.1:'+port;
 let started=false;
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error('APP_EXITED');
  try{const r=await fetch(origin+'/api/health/live',{signal:AbortSignal.timeout(1000)});if(r.ok){started=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(started,'APP_START_TIMEOUT');
 const headers={Cookie:'private='+secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',Origin:origin};
 const cases=[
  ['/api/v1/news?cursor='+secret,{headers}],
  ['/api/v1/news/'+secret,{headers}],
  ['/api/v1/news/00000000-0000-4000-8000-000000000001/participation',{method:'POST',headers,body:JSON.stringify({secret})}],
  ['/api/v1/me/activity?cursor='+secret,{headers}]
 ];
 for(const [path,options] of cases)await fetch(origin+path,options);
 for(let i=0;i<30&&output.split('\n').filter(x=>x.includes('api.request')).length<cases.length;i++)await new Promise(resolve=>setTimeout(resolve,50));
 const events=output.split('\n').flatMap(line=>{try{const x=JSON.parse(line);return x.event==='api.request'?[x]:[];}catch{return [];}});
 assert.equal(events.length,cases.length);
 assert(!JSON.stringify(events).includes(secret));
 const metrics=createMetrics();for(const event of events)metrics.consume(JSON.stringify(event));
 assert.equal(metrics.result().api.total,cases.length);
 assert.equal(metrics.result().confirmaciones.total,1);
 assert(!JSON.stringify(metrics.result()).includes(secret));
 const liveStream=new PassThrough(),reports=[];
 const watch=watchStream(liveStream,{intervalMs:60000,emit:report=>reports.push(report)});
 liveStream.end(events.map(event=>JSON.stringify(event)).join('\n')+'\n');await watch;
 assert.equal(reports[0].tipo,'entrada_finalizada');
 assert.equal(reports[0].api.total,cases.length);
 assert(!JSON.stringify(reports).includes(secret));
 assert.deepEqual(events.map(x=>x.route),['/api/v1/news','/api/v1/news/[id]','/api/v1/news/[id]/participation','/api/v1/me/activity']);
 for(const event of events){assert.match(event.requestId,/^[0-9a-f-]{36}$/);assert(Number.isInteger(event.status));assert(Number.isInteger(event.durationMs));}
 console.log('Z12 API: respuestas, errores, rutas anónimas y privacidad de logs: OK');
}finally{
 if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
}
