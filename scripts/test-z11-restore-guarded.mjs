import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {replayLocallyGuarded} from '../src/worker/purge-restore-guarded.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-guarded-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'};
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 const uid=randomUUID();await recordPurgeIntent({...journal,requestId:randomUUID(),userId:uid,requireCheckpoint:true});
 let changes=0,checks=0;
 const auditDb={async query(sql,[ids]){
  if(sql.includes('restore_unattributed_storage_present'))return {rows:[{present:false}]};
  if(sql.includes('restore_storage_present'))return {rows:ids.map(user_id=>({user_id,storage_present:false}))};
  return {rows:ids.map(user_id=>({user_id,auth_present:true,profile_present:true,pending_purge:false}))};
 }};
 const restoreDb={async query(){changes++;throw Error('SHOULD_NOT_MUTATE');}};
 const workerDb={async query(){changes++;throw Error('SHOULD_NOT_MUTATE');}};
 const common={auditDb,restoreDb,workerDb,journal,runJob:async()=>{changes++;},offline:true,checkCustody:()=>{}};
 await assert.rejects(()=>replayLocallyGuarded({...common,checkIsolation:async()=>({blocked:true})}),/PURGE_RESTORE_ISOLATION_BLOCKED/);
 assert.equal(changes,0);
 await assert.rejects(()=>replayLocallyGuarded({...common,checkIsolation:async()=>({blocked:++checks>1})}),/PURGE_RESTORE_ISOLATION_BLOCKED/);
 assert.equal(changes,0);
 await assert.rejects(()=>replayLocallyGuarded({...common,offline:false,checkIsolation:async()=>({blocked:false})}),/PURGE_RESTORE_OFFLINE_REQUIRED/);
 await assert.rejects(()=>replayLocallyGuarded({...common,checkCustody:()=>{throw Error('PURGE_STORAGE_SAME_DISK');},checkIsolation:async()=>({blocked:false})}),/PURGE_STORAGE_SAME_DISK/);
 let prepared=0,started=0,stageChecks=0;
 const preparedDb={async query(){prepared++;return {rows:[{job:{type:'account.purge',id:randomUUID(),leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+60000).toISOString()}}]};}};
 await assert.rejects(()=>replayLocallyGuarded({...common,restoreDb:preparedDb,runJob:async()=>{started++;},checkIsolation:async()=>({blocked:++stageChecks>2})}),/PURGE_RESTORE_ISOLATION_BLOCKED/);
 assert.equal(prepared,1);assert.equal(started,0);
 console.log('Z11 restauración: aislamiento y custodia bloquean la reaplicación insegura: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});await rmdir(dir);
}
