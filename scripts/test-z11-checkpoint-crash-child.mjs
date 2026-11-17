// Solo para prueba: interrumpe el proceso durante la escritura real del punto ficticio.
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
let input='';
for await(const part of process.stdin)input+=part;
const fixture=JSON.parse(input);
const originalOpen=fs.open;
fs.open=async function(path,flags,...rest){
 const handle=await originalOpen(path,flags,...rest);
 if(path!==fixture.checkpointPath||flags!=='r+')return handle;
 return new Proxy(handle,{get(target,property){
  if(property==='writeFile')return async data=>{
   await target.writeFile(String(data).slice(0,Math.floor(String(data).length/2)),'utf8');
   await target.sync();
   process.exit(23);
  };
  const value=Reflect.get(target,property,target);
  return typeof value==='function'?value.bind(target):value;
 }});
};
syncBuiltinESMExports();
const {recordPurgeIntent}=await import('../src/worker/purge-journal.mjs');
await recordPurgeIntent({...fixture,key:Buffer.from(fixture.key,'hex'),requireCheckpoint:true});
throw Error('TEST_INTERRUPTION_NOT_TRIGGERED');
