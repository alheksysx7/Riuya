import {spawn} from 'node:child_process';

const approved=new WeakSet();
export const isRestoreInternalFetch=value=>typeof value==='function'&&approved.has(value);
const remoteCode=`let raw='';for await(const chunk of process.stdin)raw+=chunk;const p=JSON.parse(raw);const r=await fetch(p.url,{method:p.method,headers:p.headers,body:p.body??undefined,signal:AbortSignal.timeout(10000)});const b=Buffer.from(await r.arrayBuffer());if(b.length>1048576)throw Error('LIMIT');process.stdout.write(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:b.toString('base64')}));`;
const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

function dockerRequest(container,payload,signal){
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'node','-e',remoteCode],{stdio:['pipe','pipe','ignore'],windowsHide:true});
  let output='',finished=false;
  const finish=(error,value)=>{
   if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(error)reject(Error('PURGE_RESTORE_INTERNAL_FETCH_FAILED'));else resolve(value);
  };
  const abort=()=>{child.kill();finish(true);};
  const timer=setTimeout(abort,15000);
  child.on('error',()=>finish(true));
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>1500000)abort();});
  child.on('close',code=>{if(code!==0)return finish(true);try{finish(false,JSON.parse(output));}catch{finish(true);}});
  child.stdin.on('error',()=>finish(true));
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  child.stdin.end(JSON.stringify(payload));
 });
}

// Solo endpoints internos necesarios para restaurar; no controla el tráfico público.
export function createRestoreInternalFetch({projectId='app'}={}){
 if(projectId!=='app'&&!/^riuya_z11_lab_[a-f0-9]{20}$/.test(projectId))throw Error('PURGE_RESTORE_INTERNAL_CONFIG_INVALID');
 const container='supabase_storage_'+projectId,authHost='supabase_auth_'+projectId;
 const fetchInternal=async(input,options={})=>{
  let url;try{url=new URL(typeof input==='string'||input instanceof URL?input:input.url);}catch{throw Error('PURGE_RESTORE_INTERNAL_SCOPE');}
  if(url.origin!=='http://127.0.0.1:54321'||url.username||url.password||url.hash||url.search)throw Error('PURGE_RESTORE_INTERNAL_SCOPE');
  const method=(options.method||'GET').toUpperCase();
  const authHealth=url.pathname==='/auth/v1/health'&&method==='GET';
  const storageHealth=url.pathname==='/storage/v1/status'&&method==='GET';
  const authUser=new RegExp('^/auth/v1/admin/users/'+uuid+'$').test(url.pathname)&&['GET','DELETE'].includes(method);
  const storageDelete=/^\/storage\/v1\/object\/[^/]+$/.test(url.pathname)&&method==='DELETE';
  if(!authHealth&&!storageHealth&&!authUser&&!storageDelete)throw Error('PURGE_RESTORE_INTERNAL_SCOPE');
  const storage=storageHealth||storageDelete;
  const path=storage?url.pathname.slice('/storage/v1'.length):url.pathname.slice('/auth/v1'.length);
  const target=(storage?'http://127.0.0.1:5000':'http://'+authHost+':9999')+path;
  if(options.body!=null&&typeof options.body!=='string')throw Error('PURGE_RESTORE_INTERNAL_SCOPE');
  if(options.body&&Buffer.byteLength(options.body)>1048576)throw Error('PURGE_RESTORE_INTERNAL_SCOPE');
  let headers;try{headers=Object.fromEntries(new Headers(options.headers));}catch{throw Error('PURGE_RESTORE_INTERNAL_SCOPE');}
  const result=await dockerRequest(container,{url:target,method,headers,body:options.body??null},options.signal);
  if(!Number.isInteger(result?.status)||result.status<200||result.status>599||typeof result.body!=='string')throw Error('PURGE_RESTORE_INTERNAL_FETCH_FAILED');
  try{return new Response([204,205,304].includes(result.status)?null:Buffer.from(result.body,'base64'),{status:result.status,headers:result.headers});}
  catch{throw Error('PURGE_RESTORE_INTERNAL_FETCH_FAILED');}
 };
 approved.add(fetchInternal);
 return fetchInternal;
}
