import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-inspect-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'},keyPath=dir+'.key';
const env={...process.env,RIUYA_PURGE_JOURNAL_DIR:dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath};
const inspect=()=>spawnSync(process.execPath,['scripts/check-z11-journal.mjs'],{env,encoding:'utf8',windowsHide:true});
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);await writeFile(keyPath,journal.key.toString('hex'),{flag:'wx'});
 const userId=randomUUID(),requestId=randomUUID();
 await recordPurgeIntent({...journal,requireCheckpoint:true,userId,requestId});
 const paths=[join(dir,'purges.ndjson'),journal.anchorPath,journal.checkpointPath,keyPath];
 const before=await Promise.all(paths.map(path=>readFile(path)));
 let result=inspect();
 assert.equal(result.status,0);assert.match(result.stdout,/coincide con el registro/);
 assert.ok(!result.stdout.includes(userId)&&!result.stdout.includes(requestId)&&!result.stdout.includes(journal.key.toString('hex')));
 const after=await Promise.all(paths.map(path=>readFile(path)));
 assert.deepEqual(after,before);
 await recordPurgeIntent({...journal,checkpointPath:undefined,userId:randomUUID(),requestId:randomUUID()});
 result=inspect();assert.equal(result.status,2);assert.match(result.stderr,/atrasado/);
 await writeFile(journal.checkpointPath,'{');
 result=inspect();assert.equal(result.status,1);assert.match(result.stderr,/PURGE_CHECKPOINT_INVALID/);
 console.log('Z11 diagnóstico: solo lectura, punto atrasado y archivo dañado: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});
 await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});
 await unlink(keyPath).catch(()=>{});
 await rmdir(dir);
}
