import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {requireRestorePurgesComplete} from '../src/worker/purge-restore-audit.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-restore-snapshot-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'};
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 await recordPurgeIntent({...journal,requestId:randomUUID(),userId:randomUUID(),requireCheckpoint:true});
 let mutate=false;
 const db={async query(sql,[ids]){
  if(sql.includes('restore_unattributed_storage_present'))return {rows:[{present:false}]};
  if(sql.includes('restore_storage_present')){
   if(mutate){mutate=false;await recordPurgeIntent({...journal,requestId:randomUUID(),userId:randomUUID(),requireCheckpoint:true});}
   return {rows:ids.map(user_id=>({user_id,storage_present:false}))};
  }
  return {rows:ids.map(user_id=>({user_id,auth_present:false,profile_present:false,pending_purge:false}))};
 }};
 assert.deepEqual(await requireRestorePurgesComplete({db,journal}),{recorded:1,remaining:0,cleared:1,inconsistent:0,ready:true});
 mutate=true;
 await assert.rejects(()=>requireRestorePurgesComplete({db,journal}),/PURGE_RESTORE_JOURNAL_CHANGED/);
 assert.deepEqual(await requireRestorePurgesComplete({db,journal}),{recorded:2,remaining:0,cleared:2,inconsistent:0,ready:true});
 console.log('Z11 restauración: cambio del registro durante auditoría bloquea autorización: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});
 await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});
 await rmdir(dir);
}
