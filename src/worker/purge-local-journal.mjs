import {readFile,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,relative,sep} from 'node:path';
import {loadStoredPurgeCheckpoint} from './purge-journal.mjs';

// Lee configuración y valida los archivos existentes; no los crea ni modifica.
export async function loadConfiguredPurgeJournal(env=process.env){
 const dir=env.RIUYA_PURGE_JOURNAL_DIR,keyPath=env.RIUYA_PURGE_JOURNAL_KEY_FILE,anchorPath=env.RIUYA_PURGE_JOURNAL_ANCHOR_FILE,checkpointPath=env.RIUYA_PURGE_CHECKPOINT_FILE;
 if(typeof dir!=='string'||!isAbsolute(dir)||typeof keyPath!=='string'||!isAbsolute(keyPath)||typeof anchorPath!=='string'||!isAbsolute(anchorPath)||typeof checkpointPath!=='string'||!isAbsolute(checkpointPath))throw Error('PURGE_JOURNAL_CONFIG_INVALID');
 let keyText,realDir,realKey,realAnchor,realCheckpoint;
 try{
  const keyInfo=await lstat(keyPath),checkpointInfo=await lstat(checkpointPath);
  if(!keyInfo.isFile()||keyInfo.isSymbolicLink()||!checkpointInfo.isFile()||checkpointInfo.isSymbolicLink())throw Error();
  [realDir,realKey,realAnchor,realCheckpoint]=await Promise.all([realpath(dir),realpath(keyPath),realpath(anchorPath),realpath(checkpointPath)]);
  const inside=relative(realDir,realKey);
  if(realKey===realAnchor||realKey===realCheckpoint||realAnchor===realCheckpoint||!inside||(!isAbsolute(inside)&&inside!=='..'&&!inside.startsWith('..'+sep)))throw Error();
  keyText=(await readFile(realKey,'utf8')).trim();
 }catch{throw Error('PURGE_JOURNAL_CONFIG_INVALID');}
 if(!/^[a-f0-9]{64}$/i.test(keyText))throw Error('PURGE_JOURNAL_CONFIG_INVALID');
 const journal={dir:realDir,keyPath:realKey,anchorPath:realAnchor,checkpointPath:realCheckpoint,key:Buffer.from(keyText,'hex')};
 const checkpoint=await loadStoredPurgeCheckpoint(journal);
 return {journal,checkpoint};
}
