import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {checkRecoveryReadiness} from '../src/worker/purge-recovery-readiness.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-ready-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'},keyPath=dir+'.key';
const env={RIUYA_PURGE_JOURNAL_DIR:dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,
 RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath,RIUYA_RESTORE_AUDIT_DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:54322/postgres'};
let connections=0,closed=0,unattributed=false,mutate=false;
const clientFactory=()=>{connections++;return {
 async connect(){},
 async query(sql,[ids]=[]){
  if(sql.includes('restore_unattributed_storage_present')){
   if(mutate){mutate=false;await recordPurgeIntent({...journal,requestId:randomUUID(),userId:randomUUID(),requireCheckpoint:true});}
   return {rows:[{present:unattributed}]};
  }
  if(sql.includes('restore_storage_present'))return {rows:ids.map(user_id=>({user_id,storage_present:false}))};
  if(sql.includes('restore_purge_audit'))return {rows:ids.map(user_id=>({user_id,auth_present:false,profile_present:false,pending_purge:false}))};
  if(['begin isolation level repeatable read read only','set local role riuya_restore_auditor','rollback'].includes(sql))return {};
  throw Error('UNEXPECTED_QUERY');
 },
 async end(){closed++;}
};};
const bridgeFactory=()=>async()=>({ok:true});
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);await writeFile(keyPath,journal.key.toString('hex'),{flag:'wx'});
 await recordPurgeIntent({...journal,requestId:randomUUID(),userId:randomUUID(),requireCheckpoint:true});
 const options={env,clientFactory,bridgeFactory,checkCustody:()=>{}};
 let result=await checkRecoveryReadiness({...options,checkIsolation:async()=>({blocked:true,blockers:['WORKER_ACTIVO']})});
 assert.deepEqual(result,{checksPassed:false,stage:'isolation',blockers:['WORKER_ACTIVO']});assert.equal(connections,0);
 result=await checkRecoveryReadiness({...options,checkIsolation:async()=>({blocked:false})});
 assert.equal(result.checksPassed,true);assert.equal(result.report.cleared,1);assert.equal(closed,1);
 unattributed=true;
 result=await checkRecoveryReadiness({...options,checkIsolation:async()=>({blocked:false})});
 assert.equal(result.checksPassed,false);assert.equal(result.unattributed,true);
 let checks=0;
 result=await checkRecoveryReadiness({...options,checkIsolation:async()=>({blocked:++checks>1,blockers:['PUERTO_API_ABIERTO']})});
 assert.equal(result.checksPassed,false);assert.equal(result.stage,'isolation');assert.equal(closed,3);
 mutate=true;
 await assert.rejects(()=>checkRecoveryReadiness({...options,checkIsolation:async()=>({blocked:false})}),/PURGE_RESTORE_JOURNAL_CHANGED/);
 assert.equal(closed,4);
 console.log('Z11 recuperación: custodia, aislamiento, auditoría y cambios posteriores: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});await unlink(keyPath).catch(()=>{});await rmdir(dir);
}
