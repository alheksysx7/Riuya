import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';

if(!process.env.npm_execpath)throw Error('TEST_REQUIRES_NPM_EXECPATH');
const port=createServer();
await new Promise((resolve,reject)=>port.once('error',reject).listen(3102,'127.0.0.1',resolve));
await new Promise(resolve=>port.close(resolve));
const env={...process.env,RIUYA_NODE:process.execPath,RIUYA_ENABLE_ACCOUNT_DELETION:'1'};
const bad=spawnSync(process.execPath,['scripts/start-local.mjs'],{env:{...env,NEXT_PUBLIC_SUPABASE_URL:'https://external.invalid'},encoding:'utf8',windowsHide:true,timeout:30000});
assert.notEqual(bad.status,0);
assert.match(bad.stderr,/configuración efectiva/);
let child,output='',exited=false;
try{
 child=spawn(process.execPath,['scripts/start-local.mjs'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{output+=chunk.toString();});
 child.stderr.on('data',chunk=>{output+=chunk.toString();});
 child.on('exit',()=>{exited=true;});
 let response;
 for(let i=0;i<160;i++){
  if(exited)throw Error('LOCAL_START_EXITED');
  try{response=await fetch('http://127.0.0.1:3102/cuenta/baja',{signal:AbortSignal.timeout(2000)});break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert(response,'LOCAL_START_TIMEOUT');
 assert.equal(response.status,404);
 assert(output.includes('Iniciando Riuya'));
 console.log('Z12 arranque: destino remoto rechazado y baja deshabilitada en proceso nuevo: OK');
}finally{
 if(child&&!exited){
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else child.kill('SIGTERM');
 }
}
