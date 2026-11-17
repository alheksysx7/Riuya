import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint} from '../src/worker/purge-journal.mjs';
import {runLocalRestore} from '../src/worker/purge-restore-runner.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-runner-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'},keyPath=dir+'.key';
const url='postgresql://fixture:fixture@127.0.0.1:54322/postgres';
const env={RIUYA_PURGE_JOURNAL_DIR:dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath,
 RIUYA_RESTORE_AUDIT_DATABASE_URL:url,RIUYA_RESTORE_CONTROL_DATABASE_URL:url,RIUYA_RESTORE_WORKER_DATABASE_URL:url,RIUYA_RESTORE_QUEUE_DATABASE_URL:url,
 RIUYA_RESTORE_ANON_KEY:'fixture',RIUYA_RESTORE_SERVICE_ROLE_KEY:'fixture',RIUYA_RESTORE_JWT_SECRET:'fixture'};
let connections=0,closed=0;
const clientFactory=()=>{connections++;return {async connect(){},async query(sql){if(sql.startsWith('set role'))return {};return {rows:[{role_name:'wrong',allowed:false}]};},async end(){closed++;}};};
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);await writeFile(keyPath,journal.key.toString('hex'),{flag:'wx'});
 await assert.rejects(()=>runLocalRestore({env,clientFactory}),/PURGE_RESTORE_OFFLINE_REQUIRED/);
 await assert.rejects(()=>runLocalRestore({env:{...env,RIUYA_RESTORE_WORKER_DATABASE_URL:'postgresql://fixture:fixture@example.invalid:54322/postgres'},offline:true,clientFactory}),/PURGE_RESTORE_CONFIG_INVALID/);
 assert.equal(connections,0);
 await assert.rejects(()=>runLocalRestore({env,offline:true,clientFactory,checkCustody:()=>{},checkIsolation:async()=>({blocked:true})}),/PURGE_RESTORE_ISOLATION_BLOCKED/);
 assert.equal(connections,0);
 await assert.rejects(()=>runLocalRestore({env,offline:true,clientFactory,checkCustody:()=>{},checkIsolation:async()=>({blocked:false})}),/PURGE_RESTORE_ROLE_INVALID/);
 assert.equal(connections,1);assert.equal(closed,1);
 console.log('Z11 recuperación: configuración, aislamiento y roles bloquean antes de modificar datos: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});await unlink(keyPath).catch(()=>{});await rmdir(dir);
}
