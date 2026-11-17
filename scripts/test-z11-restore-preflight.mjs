import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {replayRestoredPurges} from '../src/worker/purge-restore-replay.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-preflight-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'};
const first=randomUUID(),second=randomUUID();
let mutations=0;
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 await recordPurgeIntent({...journal,requireCheckpoint:true,requestId:randomUUID(),userId:first});
 await recordPurgeIntent({...journal,requireCheckpoint:true,requestId:randomUUID(),userId:second});
 const auditDb={async query(sql,[ids]){
  if(sql.includes('restore_unattributed_storage_present'))return {rows:[{present:false}]};
  if(sql.includes('restore_storage_present'))return {rows:ids.map(id=>({user_id:id,storage_present:false}))};
  return {rows:ids.map(id=>({user_id:id,auth_present:true,profile_present:id===first,pending_purge:false}))};
 }};
 const restoreDb={async query(){mutations++;throw Error('SHOULD_NOT_MUTATE');}};
 const workerDb={async query(){mutations++;throw Error('SHOULD_NOT_MUTATE');}};
 await assert.rejects(()=>replayRestoredPurges({auditDb,restoreDb,workerDb,journal,runJob:async()=>{mutations++;},offline:true}),/PURGE_RESTORE_INCONSISTENT/);
 assert.equal(mutations,0);
 console.log('Z11 restauración: inconsistencia posterior bloquea toda reaplicación: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});
 await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});
 await rmdir(dir);
}
