import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint,loadPurgeIntents,loadStoredPurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-crash-test-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'};
const requestId=randomUUID(),userId=randomUUID(),lock=join(dir,'.purge-lock');
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 const initial=await readFile(journal.checkpointPath,'utf8');
 const fixture={...journal,key:journal.key.toString('hex'),requestId,userId};
 const child=spawnSync(process.execPath,['scripts/test-z11-checkpoint-crash-child.mjs'],{
  input:JSON.stringify(fixture),encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,timeout:10000});
 assert.equal(child.status,23,'El proceso debe interrumpirse durante la publicación');
 assert.notEqual(await readFile(journal.checkpointPath,'utf8'),initial);
 // El proceso terminó sin ejecutar finally; la presencia del bloqueo detiene lecturas y escrituras.
 await assert.rejects(()=>loadPurgeIntents(journal),/PURGE_JOURNAL_CORRUPT/);
 await assert.rejects(()=>recordPurgeIntent({...journal,requireCheckpoint:true,requestId,userId}),/PURGE_JOURNAL_LOCKED/);
 // Únicamente en la prueba se retira el bloqueo del proceso terminado.
 await unlink(lock);
 await assert.rejects(()=>loadStoredPurgeCheckpoint(journal),/PURGE_CHECKPOINT_INVALID/);
 await assert.rejects(()=>recordPurgeIntent({...journal,requireCheckpoint:true,requestId,userId}),/PURGE_CHECKPOINT_INVALID/);
 assert.equal((await loadPurgeIntents(journal)).length,1);
 console.log('Z11 registro: interrupción de escritura detiene recuperación y purga: OK');
}finally{
 await unlink(lock).catch(()=>{});
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});
 await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});
 await rmdir(dir);
}
