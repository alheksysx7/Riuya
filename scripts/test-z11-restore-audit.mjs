import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,unlink,rmdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {auditRestoredPurges,requireRestorePurgesComplete} from '../src/worker/purge-restore-audit.mjs';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const dir=await mkdtemp(join(tmpdir(),'riuya-restore-audit-')),journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'};
const present=randomUUID(),absent=randomUUID(),r1=randomUUID(),r2=randomUUID(),db=new pg.Client({connectionString:status.DB_URL});let connected=false,queries=0;
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 await recordPurgeIntent({...journal,requestId:r1,userId:present});
 await recordPurgeIntent({...journal,requestId:r2,userId:absent});
 await db.connect();connected=true;await db.query('begin');
 await db.query("insert into auth.users(id,email) values($1,$2)",[present,'z11-restore-'+present+'@example.invalid']);
 await db.query('insert into private.profiles(id) values($1)',[present]);
 const rights=await db.query("select has_function_privilege('authenticated','private.restore_purge_audit(uuid[])','execute') a,has_function_privilege('riuya_worker_local','private.restore_purge_audit(uuid[])','execute') w,has_table_privilege('riuya_restore_auditor','private.profiles','select') p");
 assert.deepEqual(rights.rows[0],{a:false,w:false,p:false});
 await db.query('set local role riuya_restore_auditor');
 const limited={query(...args){queries++;return db.query(...args);}};
 let result=await auditRestoredPurges({db:limited,journal});
 assert.deepEqual(result,{recorded:2,remaining:1,cleared:1,inconsistent:0,ready:false});
 await assert.rejects(()=>requireRestorePurgesComplete({db:limited,journal}),/PURGE_RESTORE_NOT_READY/);
 await db.query('reset role');await db.query('delete from auth.users where id=$1',[present]);await db.query('set local role riuya_restore_auditor');
 result=await auditRestoredPurges({db:limited,journal});
 assert.deepEqual(result,{recorded:2,remaining:0,cleared:2,inconsistent:0,ready:true});
 assert.equal((await requireRestorePurgesComplete({db:limited,journal})).ready,true);
 // Objeto huérfano con owner_id identifica una cuenta que ya no existe.
 await db.query('reset role');
 const bucket='restore-orphan-'+randomUUID();
 await db.query('insert into storage.buckets(id,name) values($1,$1)',[bucket]);
 await db.query("insert into storage.objects(bucket_id,name,owner_id,version) values($1,'orphan.txt',$2,'fixture')",[bucket,absent]);
 await db.query('set local role riuya_restore_auditor');
 result=await auditRestoredPurges({db:limited,journal});
 assert.deepEqual(result,{recorded:2,remaining:0,cleared:1,inconsistent:1,ready:false});
 await assert.rejects(()=>requireRestorePurgesComplete({db:limited,journal}),/PURGE_RESTORE_NOT_READY/);
 const before=queries,path=join(dir,'purges.ndjson'),lines=(await readFile(path,'utf8')).trimEnd().split('\n');await writeFile(path,lines[1]+'\n');
 await assert.rejects(()=>auditRestoredPurges({db:limited,journal}),/PURGE_JOURNAL_ANCHOR_MISMATCH/);
 assert.equal(queries,before);
 console.log('Z11 restauración: auditoría bloquea cuentas presentes y registro incompleto: OK');
}finally{
 if(connected){await db.query('rollback').catch(()=>{});await db.end().catch(()=>{});}
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});
 await unlink(journal.anchorPath).catch(()=>{});await unlink(journal.checkpointPath).catch(()=>{});await rmdir(dir);
}
