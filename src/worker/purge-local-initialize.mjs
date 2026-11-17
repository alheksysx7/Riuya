import {randomBytes} from 'node:crypto';
import {open,readdir,realpath,lstat} from 'node:fs/promises';
import {dirname,basename,join,isAbsolute,relative,sep} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint} from './purge-journal.mjs';
import {verifyPurgeStorageSeparation} from './purge-storage-readiness.mjs';

async function absent(path){
 try{await lstat(path);return false;}catch(error){if(error?.code==='ENOENT')return true;throw error;}
}
function inside(dir,path){
 const rel=relative(dir,path);
 return !rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));
}
function normalized(path){return process.platform==='win32'?path.toLowerCase():path;}

// Solo inicializa archivos nuevos. No borra ni reemplaza nada ante errores.
export async function initializeLocalPurgeStorage({env=process.env,verifyStorage=verifyPurgeStorageSeparation}={}){
 const paths=[env.RIUYA_PURGE_JOURNAL_DIR,env.RIUYA_PURGE_JOURNAL_KEY_FILE,env.RIUYA_PURGE_JOURNAL_ANCHOR_FILE,env.RIUYA_PURGE_CHECKPOINT_FILE];
 if(paths.some(path=>typeof path!=='string'||!isAbsolute(path)))throw Error('PURGE_JOURNAL_CONFIG_INVALID');
 let dir,parents;
 try{
  dir=await realpath(paths[0]);
  parents=await Promise.all(paths.slice(1).map(path=>realpath(dirname(path))));
 }catch{throw Error('PURGE_JOURNAL_CONFIG_INVALID');}
 const [keyPath,anchorPath,checkpointPath]=parents.map((parent,i)=>join(parent,basename(paths[i+1])));
 if(new Set([keyPath,anchorPath,checkpointPath].map(normalized)).size!==3||
    [keyPath,anchorPath,checkpointPath].some(path=>inside(dir,path)))throw Error('PURGE_JOURNAL_CONFIG_INVALID');
 if((await readdir(dir)).length!==0||!(await absent(keyPath))||!(await absent(anchorPath))||!(await absent(checkpointPath)))throw Error('PURGE_JOURNAL_ALREADY_EXISTS');
 await verifyStorage({dir,keyPath:parents[0],anchorPath:parents[1],checkpointPath:parents[2]});
 const key=randomBytes(32);
 let file;
 try{file=await open(keyPath,'wx',0o600);await file.writeFile(key.toString('hex')+'\n','utf8');await file.sync();}
 catch{throw Error('PURGE_JOURNAL_INITIALIZE_FAILED');}
 finally{if(file)await file.close();}
 const journal={dir,key,anchorPath,checkpointPath};
 try{await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);}
 catch{throw Error('PURGE_JOURNAL_INITIALIZE_FAILED');}
 return {dir,keyPath,anchorPath,checkpointPath};
}
