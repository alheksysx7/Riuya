import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent,createPurgeCheckpoint,loadPurgeIntentsAtCheckpoint} from '../src/worker/purge-journal.mjs';
import {replayRestoredPurges} from '../src/worker/purge-restore-replay.mjs';
import {requireRestorePurgesComplete} from '../src/worker/purge-restore-audit.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-checkpoint-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'},path=join(dir,'purges.ndjson');
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 await recordPurgeIntent({...journal,requestId:randomUUID(),userId:randomUUID()});
 const oldJournal=await readFile(path),oldAnchor=await readFile(journal.anchorPath);
 const oldCheckpoint=await createPurgeCheckpoint(journal);
 await recordPurgeIntent({...journal,requestId:randomUUID(),userId:randomUUID()});
 const currentJournal=await readFile(path),currentAnchor=await readFile(journal.anchorPath);
 const checkpoint=await createPurgeCheckpoint(journal);
 assert.equal((await loadPurgeIntentsAtCheckpoint(journal,oldCheckpoint)).length,2);
 await assert.rejects(()=>loadPurgeIntentsAtCheckpoint(journal,{...checkpoint,count:1}),/PURGE_CHECKPOINT_INVALID/);
 await assert.rejects(()=>loadPurgeIntentsAtCheckpoint(journal,null),/PURGE_CHECKPOINT_INVALID/);
 let calls=0;
 const db={async query(){calls++;throw Error('SHOULD_NOT_QUERY');}};
 const savedCheckpoint=await readFile(journal.checkpointPath);
 await writeFile(journal.checkpointPath,'{');
 await assert.rejects(()=>replayRestoredPurges({auditDb:db,restoreDb:db,workerDb:db,journal,runJob:async()=>{calls++;},offline:true}),/PURGE_CHECKPOINT_INVALID/);
 assert.equal(calls,0);
 await writeFile(journal.checkpointPath,savedCheckpoint);
 await writeFile(path,oldJournal);await writeFile(journal.anchorPath,oldAnchor);
 // Registro y sello antiguos son coherentes entre sí, pero no con el punto independiente.
 await assert.rejects(()=>loadPurgeIntentsAtCheckpoint(journal,checkpoint),/PURGE_CHECKPOINT_ROLLBACK/);
 await assert.rejects(()=>replayRestoredPurges({auditDb:db,restoreDb:db,workerDb:db,journal,runJob:async()=>{calls++;},offline:true}),/PURGE_CHECKPOINT_ROLLBACK/);
 assert.equal(calls,0);
 await recordPurgeIntent({...journal,checkpointPath:undefined,requestId:randomUUID(),userId:randomUUID()});
 await assert.rejects(()=>loadPurgeIntentsAtCheckpoint(journal,checkpoint),/PURGE_CHECKPOINT_ROLLBACK/);
 await writeFile(path,currentJournal);await writeFile(journal.anchorPath,currentAnchor);
 assert.equal((await loadPurgeIntentsAtCheckpoint(journal,checkpoint)).length,2);
 await recordPurgeIntent({...journal,checkpointPath:undefined,requestId:randomUUID(),userId:randomUUID()});
 await assert.rejects(()=>replayRestoredPurges({auditDb:db,restoreDb:db,workerDb:db,journal,runJob:async()=>{calls++;},offline:true}),/PURGE_CHECKPOINT_STALE/);
 await assert.rejects(()=>requireRestorePurgesComplete({db,journal}),/PURGE_CHECKPOINT_STALE/);
 assert.equal(calls,0);
 console.log('Z11 registro: retroceso y punto atrasado bloquean restauración: OK');
}finally{
 await unlink(path).catch(()=>{});await unlink(journal.anchorPath).catch(()=>{});await unlink(journal.checkpointPath).catch(()=>{});await rmdir(dir);
}
