import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {auditRestoredPurges} from '../src/worker/purge-restore-audit.mjs';
import {replayRestoredPurges} from '../src/worker/purge-restore-replay.mjs';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const name='riuya_z11_backup_'+randomUUID().replaceAll('-','');
if(!/^riuya_z11_backup_[a-f0-9]{32}$/.test(name))throw Error('TEST_DB_INVALID');
const base=new pg.Client({connectionString:status.DB_URL}),target=new URL(status.DB_URL);target.pathname='/'+name;
const dir=await mkdtemp(join(tmpdir(),'riuya-backup-test-')),journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'};
const uid=randomUUID(),witness=randomUUID(),rid=randomUUID(),category=randomUUID(),article=randomUUID(),revision=randomUUID(),session=randomUUID(),otherJob=randomUUID();let scratch,baseConnected=false,created=false;
function docker(args,input){
 try{return execFileSync('docker',['exec','-i','supabase_db_app',...args],{input,encoding:null,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],windowsHide:true});}
 catch(e){const detail=Buffer.isBuffer(e.stderr)?e.stderr.toString('utf8').slice(0,1200):'';throw Error('TEST_BACKUP_COMMAND_FAILED '+(e.status??'')+' '+detail);}
}
async function openScratch(){
 const c=new pg.Client({connectionString:target.toString()});await c.connect();
 if((await c.query('select current_database() name')).rows[0].name!==name)throw Error('TEST_DB_INVALID');
 return c;
}
function grantScratch(){
 if(!/^riuya_z11_backup_[a-f0-9]{32}$/.test(name))throw Error('TEST_DB_INVALID');
 docker(['psql','-U','supabase_admin','-d',name,'-v','ON_ERROR_STOP=1','-c',
  'grant all on schema auth,private,storage,api,extensions to postgres; grant all on all tables in schema auth,private,storage,api to postgres; grant all on all functions in schema auth,private,storage,api to postgres;']);
}
async function createDb(){await base.query('CREATE DATABASE "'+name+'" TEMPLATE template0');created=true;}
async function dropDb(){
 if(!/^riuya_z11_backup_[a-f0-9]{32}$/.test(name))throw Error('TEST_DB_INVALID');
 await base.query('DROP DATABASE "'+name+'"');created=false;
}
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);await base.connect();baseConnected=true;await createDb();
 // Solo el esquema de la base habitual; nunca se copian sus filas.
 const schema=docker(['pg_dump','-U','postgres','--schema-only','--format=custom','--no-owner','--no-acl','postgres']);
 docker(['pg_restore','-U','supabase_admin','--no-owner','--no-acl','-d',name],schema);
 grantScratch();
 scratch=await openScratch();
 await scratch.query("insert into auth.users(id,email) values($1,$2),($3,$4)",[uid,'z11-backup-'+uid+'@example.invalid',witness,'z11-backup-'+witness+'@example.invalid']);
 await scratch.query('insert into private.profiles(id) values($1),($2)',[uid,witness]);
 await scratch.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())",[session,uid]);
 await scratch.query("insert into private.categories(id,name,slug) values($1,'Fixture','fixture')",[category]);
 await scratch.query('insert into private.articles(id,category_id) values($1,$2)',[article,category]);
 await scratch.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values($1,$2,1,'Prueba','Prueba','[]')",[revision,article]);
 await scratch.query("update private.articles set status='published',published_at=now(),current_revision_id=$2 where id=$1",[article,revision]);
 await scratch.query("insert into private.participations(user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) values($1,$3,$4,'none',gen_random_uuid(),repeat('a',64)),($2,$3,$4,'none',gen_random_uuid(),repeat('b',64))",[uid,witness,article,revision]);
 await scratch.query("insert into private.article_user_state(user_id,article_id,full_results_seen_at) values($1,$2,now())",[witness,article]);
 await scratch.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'draft.generate','{}',$2,$3)",[otherJob,'fixture-'+otherJob,witness]);
 await scratch.end();scratch=null;
 // Este respaldo completo contiene únicamente las dos cuentas ficticias.
 const backup=docker(['pg_dump','-U','supabase_admin','--format=custom','--no-owner','--no-acl',name]);
 await recordPurgeIntent({...journal,requireCheckpoint:true,requestId:rid,userId:uid});
 await dropDb();await createDb();
 docker(['pg_restore','-U','supabase_admin','--no-owner','--no-acl','-d',name],backup);
 grantScratch();
 scratch=await openScratch();
 const first=await auditRestoredPurges({db:scratch,journal});assert.equal(first.ready,false);assert.equal(first.remaining,1);
 const runJob=async({db,job})=>{
  let state=(await db.query('select private.begin_account_purge($1,$2) state',[job.id,job.leaseToken])).rows[0].state;
  if(state.stage==='started'){await db.query('select private.purge_account_contributions($1,$2)',[job.id,job.leaseToken]);state=(await db.query('select private.begin_account_purge($1,$2) state',[job.id,job.leaseToken])).rows[0].state;}
  if(state.stage==='contributions_removed'){await db.query('select private.purge_editorial_references($1,$2)',[job.id,job.leaseToken]);state=(await db.query('select private.begin_account_purge($1,$2) state',[job.id,job.leaseToken])).rows[0].state;}
  if(state.stage==='editorial_cleaned'){
   const inventory=(await db.query('select private.purge_storage_inventory($1,$2) objects',[job.id,job.leaseToken])).rows[0].objects;
   assert.deepEqual(inventory,[]);
  }
  const prepared=(await db.query('select private.prepare_account_auth_purge($1,$2) state',[job.id,job.leaseToken])).rows[0].state;
  assert.equal(prepared.userId,uid);
  const context=(await db.query('select private.purge_journal_context($1,$2) context',[job.id,job.leaseToken])).rows[0].context;
  await recordPurgeIntent({...journal,...context});
  // Solo en esta base efímera: Auth externo no apunta a la copia de prueba.
  await scratch.query('delete from auth.users where id=$1',[uid]);
  assert.equal((await db.query('select private.finish_account_purge($1,$2) ok',[job.id,job.leaseToken])).rows[0].ok,true);
 };
 const result=await replayRestoredPurges({auditDb:scratch,restoreDb:scratch,workerDb:scratch,journal,runJob,offline:true});
 assert.deepEqual(result,{recorded:1,remaining:0,cleared:1,inconsistent:0,ready:true});
 assert.equal((await scratch.query('select count(*)::int n from auth.users where id=$1',[uid])).rows[0].n,0);
 assert.equal((await scratch.query('select count(*)::int n from auth.users where id=$1',[witness])).rows[0].n,1);
 assert.equal((await scratch.query('select count(*)::int n from auth.sessions where id=$1',[session])).rows[0].n,0);
 assert.equal((await scratch.query('select count(*)::int n from private.participations where user_id=$1',[uid])).rows[0].n,0);
 assert.equal((await scratch.query('select count(*)::int n from private.participations where user_id=$1',[witness])).rows[0].n,1);
 assert.equal((await scratch.query('select full_results_seen_at is not null seen from private.article_user_state where user_id=$1 and article_id=$2',[witness,article])).rows[0].seen,true);
 assert.equal((await scratch.query('select status from private.jobs where id=$1',[otherJob])).rows[0].status,'queued');
 console.log('Z11 respaldo: restauración aislada y reaplicación con Auth simulado: OK');
}finally{
 if(scratch)await scratch.end().catch(()=>{});
 if(created&&baseConnected)await dropDb();
 if(baseConnected)await base.end().catch(()=>{});
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});await unlink(journal.anchorPath).catch(()=>{});await unlink(journal.checkpointPath).catch(()=>{});await rmdir(dir);
}
