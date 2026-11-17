import {execFileSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {join} from 'node:path';
import {evaluateRestoreIsolation} from './purge-restore-isolation.mjs';

function docker(args){
 try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:10000}).trim();}
 catch{throw Error('RESTORE_DOCKER_UNAVAILABLE');}
}
function published(name,state){
 if(!state||['exited','created','dead'].includes(state))return false;
 let ports;
 try{ports=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}',name]));}
 catch{throw Error('RESTORE_ISOLATION_UNKNOWN');}
 if(!ports||typeof ports!=='object')throw Error('RESTORE_ISOLATION_UNKNOWN');
 return Object.values(ports).some(value=>Array.isArray(value)&&value.length>0);
}
async function portOpen(host,port){
 return new Promise((resolve,reject)=>{
  const socket=createConnection({host,port});socket.setTimeout(1500);
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('timeout',()=>{socket.destroy();reject(Error('RESTORE_ISOLATION_UNKNOWN'));});
  socket.once('error',error=>{socket.destroy();if(error.code==='ECONNREFUSED')resolve(false);else reject(Error('RESTORE_ISOLATION_UNKNOWN'));});
 });
}
function workerIsRunning(){
 if(process.platform!=='win32'||!process.env.SystemRoot)throw Error('RESTORE_ISOLATION_UNKNOWN');
 const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const command=`$ErrorActionPreference='Stop'; try {
  $a='worker'+'-local.mjs'; $b='run'+'-worker.mjs';
  $found=@(Get-CimInstance Win32_Process | Where-Object {
   $_.ProcessId -ne $PID -and $_.Name -in @('node.exe','node') -and
   ($_.CommandLine -like ('*'+$a+'*') -or $_.CommandLine -like ('*'+$b+'*'))
  });
  if($found.Count -gt 0){exit 2}; exit 0
 } catch { exit 1 }`;
 try{execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',command],{stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:10000});return false;}
 catch(error){if(error?.status===2)return true;throw Error('RESTORE_ISOLATION_UNKNOWN');}
}
export async function checkLocalRestoreIsolation(){
 const containers={};
 for(const line of docker(['ps','-a','--format','{{.Names}}|{{.State}}']).split(/\r?\n/).filter(Boolean)){
  const [name,state]=line.split('|');
  if(name?.startsWith('supabase_')&&name.endsWith('_app'))containers[name]=state;
 }
 let ports;
 try{ports=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}','supabase_db_app']));}
 catch{throw Error('RESTORE_ISOLATION_UNKNOWN');}
 const appPortOpen=(await Promise.all(['127.0.0.1','::1'].map(host=>portOpen(host,3102)))).some(Boolean);
 const apiPortOpen=(await Promise.all(['127.0.0.1','::1'].map(host=>portOpen(host,54321)))).some(Boolean);
 return evaluateRestoreIsolation({containers,dbBindings:ports?.['5432/tcp']||[],appPortOpen,apiPortOpen,
  workerRunning:workerIsRunning(),authPublished:published('supabase_auth_app',containers.supabase_auth_app),storagePublished:published('supabase_storage_app',containers.supabase_storage_app)});
}
