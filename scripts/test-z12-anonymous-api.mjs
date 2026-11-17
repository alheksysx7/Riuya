import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
const server=createServer();
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const port=server.address().port;
await new Promise(resolve=>server.close(resolve));
const base='http://127.0.0.1:'+port,id='00000000-0000-4000-8000-000000000001';
let child,exited=false;
try{
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{
  cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','ignore'],env:{...process.env,APP_ORIGIN:base,RIUYA_ENABLE_ACCOUNT_DELETION:'0'}});
 child.on('exit',()=>{exited=true;});
 let ready=false;
 for(let i=0;i<100;i++){
  if(exited)throw Error('TEST_SERVER_EXITED');
  try{ready=(await fetch(base+'/api/health/live',{signal:AbortSignal.timeout(1000)})).ok;if(ready)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(ready);
 const cases=[['GET','participation'],['POST','participation'],['POST','omit'],['POST','results/access']];
 for(const [method,path] of cases){
  const response=await fetch(base+'/api/v1/news/'+id+'/'+path,{method,headers:{Origin:base,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
  assert.equal(response.status,401,'EXPECTED_ANONYMOUS_401 '+method+' '+path);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
 }
 console.log('Z12 sesión ausente: participación, omisión y resultados responden 401 sin caché: OK');
}finally{
 if(child&&!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
}
