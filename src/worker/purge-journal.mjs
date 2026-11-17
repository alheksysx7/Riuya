import {createCipheriv,createDecipheriv,randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {open,readFile,readdir,lstat,unlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const journalName='purges.ndjson',lockName='.purge-lock',maxBytes=16*1024*1024;
function validate(dir,key,anchorPath){
 if(typeof dir!=='string'||!isAbsolute(dir)||!Buffer.isBuffer(key)||key.length!==32||typeof anchorPath!=='string'||!isAbsolute(anchorPath))throw Error('PURGE_JOURNAL_CONFIG_INVALID');
 const rel=relative(resolve(dir),resolve(anchorPath));
 if(!rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep)))throw Error('PURGE_JOURNAL_CONFIG_INVALID');
}
function encrypt(key,requestId,userId){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('riuya-purge-v2:'+requestId));
 const body=Buffer.concat([cipher.update(JSON.stringify({requestId,userId,recordedAt:new Date().toISOString()}),'utf8'),cipher.final()]);
 return JSON.stringify({version:2,requestId,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),ciphertext:body.toString('base64url')})+'\n';
}
function decrypt(line,key){
 try{
  const obj=JSON.parse(line),id=obj.requestId;
  if(obj.version!==2||!uuid.test(id||'')||id!==id.toLowerCase()||typeof obj.iv!=='string'||typeof obj.tag!=='string'||typeof obj.ciphertext!=='string')throw Error();
  const iv=Buffer.from(obj.iv,'base64url'),tag=Buffer.from(obj.tag,'base64url'),body=Buffer.from(obj.ciphertext,'base64url');
  if(iv.length!==12||tag.length!==16||body.length>1024)throw Error();
  const decipher=createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(Buffer.from('riuya-purge-v2:'+id));decipher.setAuthTag(tag);
  const record=JSON.parse(Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8'));
  if(record.requestId!==id||!uuid.test(record.userId||'')||typeof record.recordedAt!=='string'||Number.isNaN(Date.parse(record.recordedAt)))throw Error();
  return record;
 }catch{throw Error('PURGE_JOURNAL_CORRUPT');}
}
async function regularFile(path,limit){
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw Error('PURGE_JOURNAL_CORRUPT');
 return readFile(path);
}
async function snapshot({dir,key,allowLock=false}){
 const entries=await readdir(dir,{withFileTypes:true});
 if(entries.some(x=>x.name!==journalName&&!(allowLock&&x.name===lockName&&x.isFile()))||!entries.some(x=>x.name===journalName&&x.isFile()))throw Error('PURGE_JOURNAL_CORRUPT');
 const bytes=await regularFile(join(dir,journalName),maxBytes),text=bytes.toString('utf8');
 if(text&&(!text.endsWith('\n')||text.includes('\r')))throw Error('PURGE_JOURNAL_CORRUPT');
 const lines=text?text.slice(0,-1).split('\n'):[],records=[],seen=new Set();
 for(const line of lines){
  if(!line||Buffer.byteLength(line)>4096)throw Error('PURGE_JOURNAL_CORRUPT');
  const record=decrypt(line,key);
  if(seen.has(record.requestId))throw Error('PURGE_JOURNAL_CORRUPT');
  seen.add(record.requestId);records.push(record);
 }
 return {version:2,count:records.length,digest:createHash('sha256').update(bytes).digest('hex'),records,bytes};
}
function anchorMac(key,value){return createHmac('sha256',key).update('riuya-journal-anchor-v2:'+value.count+':'+value.digest).digest('hex');}
async function readAnchor(anchorPath,key){
 try{
  const bytes=await regularFile(anchorPath,1024),value=JSON.parse(bytes.toString('utf8'));
  if(value.version!==2||!Number.isSafeInteger(value.count)||value.count<0||!/^[a-f0-9]{64}$/.test(value.digest||'')||!/^[a-f0-9]{64}$/.test(value.mac||''))throw Error();
  if(!timingSafeEqual(Buffer.from(value.mac,'hex'),Buffer.from(anchorMac(key,value),'hex')))throw Error();
  return value;
 }catch{throw Error('PURGE_JOURNAL_ANCHOR_INVALID');}
}
async function verifyAnchor({dir,key,anchorPath,allowLock=false}){
 const saved=await readAnchor(anchorPath,key),current=await snapshot({dir,key,allowLock});
 if(saved.count!==current.count||saved.digest!==current.digest)throw Error('PURGE_JOURNAL_ANCHOR_MISMATCH');
 return current;
}
function anchorData(key,value){return JSON.stringify({version:2,count:value.count,digest:value.digest,mac:anchorMac(key,value)})+'\n';}
async function updateAnchor({dir,key,anchorPath}){
 const value=await snapshot({dir,key,allowLock:true}),data=anchorData(key,value);let file;
 try{
  // El archivo ya existe: una interrupción durante la actualización produce
  // un sello inválido y detiene la purga, en vez de publicar un nombre nuevo.
  await regularFile(anchorPath,1024);file=await open(anchorPath,'r+');
  await file.writeFile(data,'utf8');await file.truncate(Buffer.byteLength(data));await file.sync();
 }catch{throw Error('PURGE_JOURNAL_ANCHOR_WRITE_FAILED');}
 finally{if(file)await file.close();}
}
export async function initializePurgeJournal({dir,key,anchorPath}){
 validate(dir,key,anchorPath);
 if((await readdir(dir)).length!==0)throw Error('PURGE_JOURNAL_NOT_EMPTY');
 let journal,anchor;
 try{
  journal=await open(join(dir,journalName),'wx',0o600);await journal.sync();await journal.close();journal=null;
  const value=await snapshot({dir,key});anchor=await open(anchorPath,'wx',0o600);
  await anchor.writeFile(anchorData(key,value),'utf8');await anchor.sync();
 }catch{throw Error('PURGE_JOURNAL_ANCHOR_WRITE_FAILED');}
 finally{if(journal)await journal.close();if(anchor)await anchor.close();}
}

// Los archivos de datos y sello se crean antes de activar la purga.
// Una escritura incompleta o un sello inconsistente detiene la operación.
export async function recordPurgeIntent({dir,key,anchorPath,checkpointPath,requireCheckpoint=false,requestId,userId}){
 validate(dir,key,anchorPath);
 if(!uuid.test(requestId||'')||!uuid.test(userId||''))throw Error('PURGE_JOURNAL_INVALID');
 if(requireCheckpoint&&!checkpointPath)throw Error('PURGE_CHECKPOINT_INVALID');
 if(checkpointPath)await validateCheckpointPath({dir,anchorPath,checkpointPath});
 const id=requestId.toLowerCase(),user=userId.toLowerCase(),lockPath=join(dir,lockName);let lock;
 try{lock=await open(lockPath,'wx',0o600);}catch(e){throw Error(e?.code==='EEXIST'?'PURGE_JOURNAL_LOCKED':'PURGE_JOURNAL_WRITE_FAILED');}
 try{
  const current=await verifyAnchor({dir,key,anchorPath,allowLock:true});
  if(checkpointPath)verifyCheckpoint(current,key,await readCheckpoint(checkpointPath));
  const old=current.records.find(x=>x.requestId===id);
  if(old){
   if(old.userId!==user)throw Error('PURGE_JOURNAL_CONFLICT');
   if(checkpointPath)await publishCheckpoint({dir,key,anchorPath,checkpointPath});
   return;
  }
  const line=encrypt(key,id,user),path=join(dir,journalName);
  if(Buffer.byteLength(line)+((await lstat(path)).size)>maxBytes)throw Error('PURGE_JOURNAL_LIMIT');
  let file;
  try{file=await open(path,'a');await file.writeFile(line,'utf8');await file.sync();}
  catch{throw Error('PURGE_JOURNAL_WRITE_FAILED');}
  finally{if(file)await file.close();}
  await updateAnchor({dir,key,anchorPath});
  if(checkpointPath)await publishCheckpoint({dir,key,anchorPath,checkpointPath});
 }finally{await lock.close();await unlink(lockPath);}
}
export async function loadPurgeIntents({dir,key,anchorPath}){
 validate(dir,key,anchorPath);
 return (await verifyAnchor({dir,key,anchorPath})).records;
}

// El punto de control debe conservarse independientemente del respaldo restaurado.
function checkpointMac(key,count,digest){
 return createHmac('sha256',key).update('riuya-journal-checkpoint-v1:'+count+':'+digest).digest('hex');
}
export async function createPurgeCheckpoint(options){
 validate(options.dir,options.key,options.anchorPath);
 const state=await verifyAnchor(options);
 return {version:1,count:state.count,digest:state.digest,mac:checkpointMac(options.key,state.count,state.digest)};
}

function verifyCheckpoint(state,key,checkpoint){
 if(!checkpoint||checkpoint.version!==1||!Number.isSafeInteger(checkpoint.count)||checkpoint.count<0||
    !/^[a-f0-9]{64}$/.test(checkpoint.digest||'')||!/^[a-f0-9]{64}$/.test(checkpoint.mac||'')||
    !timingSafeEqual(Buffer.from(checkpoint.mac,'hex'),Buffer.from(checkpointMac(key,checkpoint.count,checkpoint.digest),'hex')))
  throw Error('PURGE_CHECKPOINT_INVALID');
 if(state.count<checkpoint.count)throw Error('PURGE_CHECKPOINT_ROLLBACK');
 const lines=state.bytes.toString('utf8').split('\n');
 const prefix=checkpoint.count?lines.slice(0,checkpoint.count).join('\n')+'\n':'';
 if(createHash('sha256').update(prefix,'utf8').digest('hex')!==checkpoint.digest)throw Error('PURGE_CHECKPOINT_ROLLBACK');
}
export async function loadPurgeIntentsAtCheckpoint(options,checkpoint){
 validate(options.dir,options.key,options.anchorPath);
 const state=await verifyAnchor(options);
 verifyCheckpoint(state,options.key,checkpoint);
 return state.records;
}
async function validateCheckpointPath({dir,anchorPath,checkpointPath}){
 if(typeof checkpointPath!=='string'||!isAbsolute(checkpointPath))throw Error('PURGE_CHECKPOINT_INVALID');
 const rel=relative(resolve(dir),resolve(checkpointPath));
 if(!rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep))||resolve(anchorPath)===resolve(checkpointPath))
  throw Error('PURGE_CHECKPOINT_INVALID');
}
async function readCheckpoint(path){
 try{return JSON.parse((await regularFile(path,1024)).toString('utf8'));}
 catch{throw Error('PURGE_CHECKPOINT_INVALID');}
}
export async function initializePurgeCheckpoint(options){
 validate(options.dir,options.key,options.anchorPath);
 await validateCheckpointPath(options);
 const checkpoint=await createPurgeCheckpoint(options);
 let file;
 try{
  file=await open(options.checkpointPath,'wx',0o600);
  await file.writeFile(JSON.stringify(checkpoint)+'\n','utf8');await file.sync();
 }catch{throw Error('PURGE_CHECKPOINT_WRITE_FAILED');}
 finally{if(file)await file.close();}
}
async function publishCheckpoint({dir,key,anchorPath,checkpointPath}){
 const state=await verifyAnchor({dir,key,anchorPath,allowLock:true});
 const data=JSON.stringify({version:1,count:state.count,digest:state.digest,mac:checkpointMac(key,state.count,state.digest)})+'\n';
 let file;
 try{
  await regularFile(checkpointPath,1024);
  file=await open(checkpointPath,'r+');
  await file.writeFile(data,'utf8');await file.truncate(Buffer.byteLength(data));await file.sync();
 }catch{throw Error('PURGE_CHECKPOINT_WRITE_FAILED');}
 finally{if(file)await file.close();}
}
export async function loadStoredPurgeCheckpoint(options){
 validate(options.dir,options.key,options.anchorPath);
 await validateCheckpointPath(options);
 const checkpoint=await readCheckpoint(options.checkpointPath);
 await loadPurgeIntentsAtCheckpoint(options,checkpoint);
 return checkpoint;
}

// La reapertura tras restaurar exige un punto independiente al día.
export async function loadCurrentPurgeIntents(options){
 const checkpoint=await loadStoredPurgeCheckpoint(options);
 const records=await loadPurgeIntentsAtCheckpoint(options,checkpoint);
 if(checkpoint.count!==records.length)throw Error('PURGE_CHECKPOINT_STALE');
 return records;
}
