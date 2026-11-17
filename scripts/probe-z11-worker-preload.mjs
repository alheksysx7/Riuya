// Instrumentación exclusiva del proceso de ensayo: ninguna conexión puede ir al proyecto habitual.
import {createRequire,syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
const require=createRequire(process.env.RIUYA_LAB_APP_ENTRY);
const pg=require('pg'),NativeClient=pg.Client;
const db=new URL(process.env.RIUYA_LAB_WORKER_DB),api=new URL(process.env.RIUYA_LAB_API);
if(db.hostname!=='127.0.0.1'||db.port==='54322'||api.hostname!=='127.0.0.1'||api.port==='54321')throw Error('LAB_SCOPE_INVALID');
pg.Client=class extends NativeClient{
 constructor(options){
  if(options?.host!=='127.0.0.1'||options?.port!==54322||options?.user!=='riuya_worker_local')throw Error('LAB_DB_SCOPE');
  super({connectionString:db.toString(),connectionTimeoutMillis:5000});
 }
};
// En el laboratorio todos los archivos son ficticios y comparten disco.
const originalExec=childProcess.execFileSync;
childProcess.execFileSync=function(command,args,options){
 if(typeof command==='string'&&command.toLowerCase().endsWith('powershell.exe')&&Array.isArray(args)&&args.some(x=>typeof x==='string'&&x.includes('RIUYA_CHECK_JOURNAL_PATH')))return options?.encoding?'':Buffer.alloc(0);
 return originalExec(command,args,options);
};
syncBuiltinESMExports();
const originalFetch=globalThis.fetch;
let delayed=false;
globalThis.fetch=async(input,options={})=>{
 const source=new URL(typeof input==='string'?input:input.url);
 if(source.origin!=='http://127.0.0.1:54321')throw Error('LAB_NETWORK_SCOPE');
 if(!delayed&&source.pathname.startsWith('/storage/v1/object/')&&options.method==='DELETE'){
  delayed=true;await new Promise(resolve=>setTimeout(resolve,12000));
 }
 return originalFetch(new URL(source.pathname+source.search,api),options);
};
process.on('message',value=>{if(value==='stop'){process.emit('SIGTERM');process.disconnect();}});
