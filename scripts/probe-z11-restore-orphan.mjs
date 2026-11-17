import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import pg from 'pg';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {auditRestoredPurges,requireRestorePurgesComplete} from '../src/worker/purge-restore-audit.mjs';
import {replayRestoredPurges} from '../src/worker/purge-restore-replay.mjs';

export async function probeLabRestoreOrphan({status,dir}){
 const target=new URL(status.DB_URL);
 if(target.hostname!=='127.0.0.1'||target.port==='54322')throw Error('LAB_SCOPE_INVALID');
 const db=new pg.Client({connectionString:status.DB_URL}),uid=randomUUID(),bucket='orphan-'+randomUUID();
 const journalDir=join(dir,'orphan-journal');await mkdir(journalDir);
 const journal={dir:journalDir,key:randomBytes(32),anchorPath:join(dir,'orphan.anchor'),checkpointPath:join(dir,'orphan.checkpoint')};
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 await recordPurgeIntent({...journal,requestId:randomUUID(),userId:uid,requireCheckpoint:true});
 await db.connect();
 try{
  await db.query('insert into storage.buckets(id,name) values($1,$1)',[bucket]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id,version) values($1,'orphan.txt',$2,'fixture')",[bucket,uid]);
  const auditDb={async query(sql,args){await db.query('begin');try{await db.query('set local role riuya_restore_auditor');const r=await db.query(sql,args);await db.query('commit');return r;}catch(e){await db.query('rollback');throw e;}}};
  const report=await auditRestoredPurges({db:auditDb,journal});
  assert.deepEqual(report,{recorded:1,remaining:0,cleared:0,inconsistent:1,ready:false});
  await assert.rejects(()=>requireRestorePurgesComplete({db:auditDb,journal}),/PURGE_RESTORE_NOT_READY/);
  let changes=0;const mutating={async query(){changes++;throw Error('SHOULD_NOT_MUTATE');}};
  await assert.rejects(()=>replayRestoredPurges({auditDb,restoreDb:mutating,workerDb:mutating,journal,runJob:async()=>{changes++;},offline:true}),/PURGE_RESTORE_INCONSISTENT/);
  assert.equal(changes,0);
  const keyPath=join(dir,'orphan.key');await writeFile(keyPath,journal.key.toString('hex'),{flag:'wx'});
  const checkEntry=resolve('scripts/check-z11-restore.mjs'),preload=pathToFileURL(resolve('scripts/probe-z11-restore-preload.mjs')).href;
  const env={...process.env,RIUYA_LAB_APP_ENTRY:checkEntry,RIUYA_LAB_AUDIT_DB:status.DB_URL,
   RIUYA_RESTORE_AUDIT_DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:54322/postgres',
   RIUYA_PURGE_JOURNAL_DIR:journal.dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,
   RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath};
  const inspect=extra=>spawnSync(process.execPath,['--import',preload,checkEntry],{env:{...env,...extra},encoding:'utf8',windowsHide:true});
  let check=inspect({});
  assert.equal(check.status,2);assert.match(check.stdout,/Inconsistentes: 1/);
  assert.ok(!check.stdout.includes(uid)&&!check.stderr.includes(uid)&&!check.stdout.includes(journal.key.toString('hex')));
  check=inspect({RIUYA_RESTORE_AUDIT_DATABASE_URL:'postgresql://fixture:fixture@example.invalid:54322/postgres'});
  assert.equal(check.status,1);assert.match(check.stderr,/RESTORE_AUDIT_DATABASE_INVALID/);
  const cleanDir=join(dir,'clean-journal');await mkdir(cleanDir);
  const clean={dir:cleanDir,key:randomBytes(32),anchorPath:join(dir,'clean.anchor'),checkpointPath:join(dir,'clean.checkpoint')};
  await initializePurgeJournal(clean);await initializePurgeCheckpoint(clean);
  await recordPurgeIntent({...clean,requestId:randomUUID(),userId:randomUUID(),requireCheckpoint:true});
  const cleanKey=join(dir,'clean.key');await writeFile(cleanKey,clean.key.toString('hex'),{flag:'wx'});
  check=inspect({RIUYA_PURGE_JOURNAL_DIR:clean.dir,RIUYA_PURGE_JOURNAL_KEY_FILE:cleanKey,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:clean.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:clean.checkpointPath});
  assert.equal(check.status,0);assert.match(check.stdout,/Sin datos detectados: 1/);
  assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bucket])).rows[0].n,1);
  await db.query("insert into storage.objects(bucket_id,name,version) values($1,'unattributed.txt','fixture')",[bucket]);
  check=inspect({RIUYA_PURGE_JOURNAL_DIR:clean.dir,RIUYA_PURGE_JOURNAL_KEY_FILE:cleanKey,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:clean.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:clean.checkpointPath});
  assert.equal(check.status,2);assert.match(check.stdout,/Archivos sin propietario verificable: sí/);
  await assert.rejects(()=>requireRestorePurgesComplete({db:auditDb,journal:clean}),/PURGE_RESTORE_UNATTRIBUTED_STORAGE/);
  await assert.rejects(()=>replayRestoredPurges({auditDb,restoreDb:mutating,workerDb:mutating,journal:clean,runJob:async()=>{changes++;},offline:true}),/PURGE_RESTORE_UNATTRIBUTED_STORAGE/);
  assert.equal(changes,0);
  console.log('Z11 restauración: objetos huérfanos y sin propietario bloquean la apertura: OK');
 }finally{await db.end();}
}
