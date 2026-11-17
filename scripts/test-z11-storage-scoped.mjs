import {execFileSync} from 'node:child_process';
import {randomUUID,createHmac,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {createScopedPurgeStorage} from '../src/worker/purge-storage-auth.mjs';
import {clearPurgeStorage} from '../src/worker/purge-storage.mjs';
import {createLocalPurgeAuthAdmin} from '../src/worker/purge-auth.mjs';
import {processAccountPurge} from '../src/worker/purge-account.mjs';
import {initializePurgeJournal,initializePurgeCheckpoint} from '../src/worker/purge-journal.mjs';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322')||!status.JWT_SECRET)throw Error('Solo entorno local');
const journal={dir:await mkdtemp(join(tmpdir(),'riuya-storage-journal-')),key:randomBytes(32)};
journal.anchorPath=journal.dir+'.anchor';journal.checkpointPath=journal.dir+'.checkpoint';await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const db=new pg.Client({connectionString:status.DB_URL});const id=randomUUID().replaceAll('-','');const bucket='z11-scope-'+id;const policy='z11_fixture_'+id;const job=randomUUID(),request=randomUUID(),lease=randomUUID();const users=[];let bucketCreated=false,policyCreated=false,jobCreated=false,connected=false,assetId,blocker;
function jwt(payload){
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const head=enc({alg:'HS256',typ:'JWT'}),body=enc({...payload,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60});
 return head+'.'+body+'.'+createHmac('sha256',status.JWT_SECRET).update(head+'.'+body).digest('base64url');
}
function scoped(token){return createClient(status.API_URL,status.ANON_KEY,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});}
try{
 await db.connect();connected=true;
 for(let i=0;i<2;i++){
  const r=await admin.auth.admin.createUser({email:'z11-scope-'+id+'-'+i+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
  if(r.error||!r.data.user)throw Error('TEST_USER_CREATE '+(r.error?.status||'')+' '+(r.error?.message||''));users.push(r.data.user.id);
 }
 const [u,v]=users;
 await db.query("insert into private.profiles(id,account_status) values($1,'deletion_pending'),($2,'active') on conflict(id) do update set account_status=excluded.account_status",[u,v]);
 await db.query("insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values($1,$2,now()-interval '8 days',now()-interval '1 day','pending')",[request,u]);
 await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4,'running','z11-fixture',$5,now()+interval '5 minutes')",[job,request,'z11-scope-'+id,u,lease]);jobCreated=true;
 await db.query('begin');await db.query('set local role riuya_purge_executor');
 await db.query('select private.purge_account_contributions($1,$2)',[job,lease]);await db.query('select private.purge_editorial_references($1,$2)',[job,lease]);await db.query('commit');
 let r=await admin.storage.createBucket(bucket,{public:false});if(r.error)throw Error('TEST_BUCKET_CREATE');bucketCreated=true;
 await db.query(`create policy ${policy} on storage.objects for insert to authenticated with check (bucket_id = '${bucket}' and owner_id = (current_setting('request.jwt.claims',true)::jsonb->>'sub'))`);policyCreated=true;
 const one=scoped(jwt({role:'authenticated',sub:u})),two=scoped(jwt({role:'authenticated',sub:v}));
 for(const [client,name] of [[one,'own.txt'],[one,'late.txt'],[one,'swap.txt'],[two,'other.txt']]){
  r=await client.storage.from(bucket).upload(name,new Blob(['fixture']),{contentType:'text/plain'});if(r.error)throw Error('TEST_UPLOAD '+r.error.message);
 }
 let q=await db.query('select name,owner_id from storage.objects where bucket_id=$1 order by name',[bucket]);
 assert.deepEqual(q.rows.map(x=>[x.name,x.owner_id]),[['late.txt',u],['other.txt',v],['own.txt',u],['swap.txt',u]]);
 const wrong=scoped(jwt({role:'riuya_storage_purger',sub:u,purge_job:job,purge_lease:randomUUID()}));
 r=await wrong.storage.from(bucket).remove(['own.txt']);assert.ok(r.error||!r.data?.length);
 assert.equal((await admin.storage.from(bucket).download('own.txt')).error,null);
 // La ruta cambia de dueño entre el inventario y el borrado.
 r=await admin.storage.from(bucket).remove(['swap.txt']);if(r.error)throw Error('TEST_REPLACE_REMOVE');
 r=await two.storage.from(bucket).upload('swap.txt',new Blob(['otro propietario']),{contentType:'text/plain'});if(r.error)throw Error('TEST_REPLACE_UPLOAD');
 assert.throws(()=>createScopedPurgeStorage({apiUrl:'https://invalid.example',anonKey:'x',jwtSecret:'x',userId:u,jobId:job,leaseToken:lease,leaseUntil:new Date(Date.now()+60000)}),/PURGE_STORAGE_CONFIG_INVALID/);
 const purge=createScopedPurgeStorage({apiUrl:status.API_URL,anonKey:status.ANON_KEY,jwtSecret:status.JWT_SECRET,userId:u,jobId:job,leaseToken:lease,leaseUntil:new Date(Date.now()+240000)});
 r=await purge.from(bucket).remove(['own.txt','other.txt','swap.txt']);if(r.error)throw Error('TEST_PURGE '+r.error.message);
 assert.ok((await admin.storage.from(bucket).download('own.txt')).error);
 assert.equal((await admin.storage.from(bucket).download('other.txt')).error,null);
 assert.equal((await admin.storage.from(bucket).download('swap.txt')).error,null);
 q=await db.query('select owner_id from storage.objects where bucket_id=$1 and name=$2',[bucket,'swap.txt']);assert.equal(q.rows[0].owner_id,v);
 await db.query("update private.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[job]);
 r=await purge.from(bucket).remove(['late.txt']);assert.ok(r.error||!r.data?.length);
 assert.equal((await admin.storage.from(bucket).download('late.txt')).error,null);
 await db.query("update private.jobs set lease_until=clock_timestamp()+interval '5 minutes' where id=$1",[job]);
 const inventoryDb={async query(_sql,params){
  await db.query('begin');try{
   await db.query('set local role riuya_storage_inventory');
   const value=await db.query('select private.purge_storage_inventory($1,$2) inventory',params);
   await db.query('commit');return value;
  }catch(e){await db.query('rollback');throw e;}
 }};
 await clearPurgeStorage({db:inventoryDb,storage:purge,job:{id:job,leaseToken:lease}});
 await clearPurgeStorage({db:inventoryDb,storage:purge,job:{id:job,leaseToken:lease}});
 assert.ok((await admin.storage.from(bucket).download('late.txt')).error);
 assert.equal((await admin.storage.from(bucket).download('swap.txt')).error,null);
 // Recorrido completo: un nuevo archivo propio se borra antes de eliminar Auth.
 r=await one.storage.from(bucket).upload('final.txt',new Blob(['fixture']),{contentType:'text/plain'});if(r.error)throw Error('TEST_FINAL_UPLOAD');
 const executor={async query(sql,params){await db.query('begin');try{
  await db.query('set local role riuya_purge_worker_client');const result=await db.query(sql,params);await db.query('commit');return result;
 }catch(e){await db.query('rollback');throw e;}}};
 const asset=assetId=randomUUID();
 await db.query("insert into private.assets(id,path,mime_type,sha256,owner_id,version,validation_status,storage_bucket_id,storage_object_name) values($1,'fixture','text/plain',repeat('a',64),$2,'1','provisional',$3,'final.txt')",[asset,u,bucket]);
 await db.query('update private.profiles set avatar_asset_id=$1 where id in ($2,$3)',[asset,u,v]);
 const finalVersion=(await db.query("select version from storage.objects where bucket_id=$1 and name='final.txt'",[bucket])).rows[0].version;
 r=await purge.from(bucket).remove([{path:'final.txt',versionId:finalVersion}]);
 assert.ok(r.error||!r.data?.length);assert.equal((await admin.storage.from(bucket).download('final.txt')).error,null);
 // La referencia de la otra cuenta se confirma mientras Storage espera el activo.
 await db.query('update private.profiles set avatar_asset_id=null where id=$1',[v]);
 blocker=new pg.Client({connectionString:status.DB_URL});await blocker.connect();await blocker.query('begin');
 const blockerPid=(await blocker.query('select pg_backend_pid() pid')).rows[0].pid;
 await blocker.query('update private.profiles set avatar_asset_id=$1 where id=$2',[asset,v]);
 let completed=false;
 const competing=purge.from(bucket).remove([{path:'final.txt',versionId:finalVersion}]).then(value=>{completed=true;return value;},error=>{completed=true;throw error;});
 let waiting=false;
 for(let i=0;i<60;i++){
  const q=await db.query("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) waiting",[blockerPid]);
  if(q.rows[0].waiting){waiting=true;break;}if(completed)break;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 if(!waiting){await blocker.query('rollback');await competing.catch(()=>{});throw Error('TEST_ASSET_LOCK_NOT_OBSERVED');}
 await blocker.query('commit');r=await competing;
 assert.ok(r.error||!r.data?.length);assert.equal((await admin.storage.from(bucket).download('final.txt')).error,null);
 await blocker.end();blocker=null;
 const purgeAdmin=createLocalPurgeAuthAdmin({apiUrl:status.API_URL,serviceRoleKey:status.SERVICE_ROLE_KEY});
 const args={db:executor,job:{type:'account.purge',id:job,leaseToken:lease,leaseUntil:new Date(Date.now()+240000)},admin:purgeAdmin,journal,storageConfig:{apiUrl:status.API_URL,anonKey:status.ANON_KEY,jwtSecret:status.JWT_SECRET}};
 await assert.rejects(()=>processAccountPurge(args),/PURGE_ASSET_SHARED/);
 assert.equal((await admin.storage.from(bucket).download('final.txt')).error,null);
 await db.query('update private.profiles set avatar_asset_id=null where id=$1',[v]);
 await processAccountPurge(args);
 assert.equal((await db.query('select count(*)::int n from private.assets where id=$1',[asset])).rows[0].n,0);
 assert.ok((await admin.storage.from(bucket).download('final.txt')).error);
 assert.equal((await admin.auth.admin.getUserById(u)).error?.status,404);
 assert.equal((await admin.auth.admin.getUserById(v)).error,null);
 assert.equal((await admin.storage.from(bucket).download('other.txt')).error,null);
 q=await db.query('select stage,user_id from private.account_purge_operations where job_id=$1',[job]);assert.deepEqual(q.rows[0],{stage:'finalized',user_id:null});
 console.log('Z11 Storage y Auth: aislamiento, activo compartido concurrente y purga completa: OK');
}finally{
 if(blocker){await blocker.query('rollback').catch(()=>{});await blocker.end().catch(()=>{});}
 if(connected)await db.query('rollback').catch(()=>{});
 if(policyCreated)await db.query(`drop policy ${policy} on storage.objects`);
 if(bucketCreated){const e=await admin.storage.emptyBucket(bucket);if(e.error)throw Error('TEST_BUCKET_CLEANUP');const d=await admin.storage.deleteBucket(bucket);if(d.error)throw Error('TEST_BUCKET_DELETE');}
 if(connected&&assetId){
  await db.query('update private.profiles set avatar_asset_id=null where id=any($1::uuid[]) and avatar_asset_id=$2',[users,assetId]);
  await db.query('delete from private.assets where id=$1 and owner_id=any($2::uuid[])',[assetId,users]);
 }
 if(jobCreated){await db.query('delete from private.account_purge_operations where job_id=$1',[job]);await db.query('delete from private.jobs where id=$1',[job]);}
 for(const user of users){const d=await admin.auth.admin.deleteUser(user);if(d.error&&d.error.status!==404)throw Error('TEST_USER_CLEANUP');}
 await db.end().catch(()=>{});
 for(const name of await readdir(journal.dir)){if(name!=='purges.ndjson')throw Error('TEST_JOURNAL_CLEANUP');await unlink(join(journal.dir,name));}
 await rmdir(journal.dir);await unlink(journal.anchorPath);await unlink(journal.checkpointPath);
}
