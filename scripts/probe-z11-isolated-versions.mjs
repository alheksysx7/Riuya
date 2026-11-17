import {execFileSync} from 'node:child_process';
import {randomUUID,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {removePurgeObjects} from '../src/worker/purge-storage.mjs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {StorageClient} from '@supabase/storage-js';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const suffix=randomUUID().replaceAll('-',''),database='riuya_z11_versions_'+suffix,container='riuya-z11-versions-'+suffix,bucket='fixture-'+suffix;
if(!/^riuya_z11_versions_[a-f0-9]{32}$/.test(database)||!/^riuya-z11-versions-[a-f0-9]{32}$/.test(container))throw Error('TEST_SCOPE');
const base=new pg.Client({connectionString:status.DB_URL}),target=new URL(status.DB_URL);target.pathname='/'+database;
let scratch,baseConnected=false,created=false,containerStarted=false;
function docker(args,options={}){try{return execFileSync('docker',args,{encoding:null,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],windowsHide:true,...options});}catch(e){throw Error('TEST_DOCKER_FAILED '+(e.status??''));}}
try{
 await base.connect();baseConnected=true;await base.query('CREATE DATABASE "'+database+'" TEMPLATE template0');created=true;
 const schema=docker(['exec','-i','supabase_db_app','pg_dump','-U','postgres','--schema-only','--format=custom','--no-owner','--no-acl','postgres']);
 docker(['exec','-i','supabase_db_app','pg_restore','-U','supabase_admin','--no-owner','--no-acl','-d',database],{input:schema});
 const migrations=docker(['exec','-i','supabase_db_app','pg_dump','-U','supabase_admin','--data-only','--format=custom','--no-owner','--no-acl','-t','storage.migrations','postgres']);
 docker(['exec','-i','supabase_db_app','pg_restore','-U','supabase_admin','--data-only','--no-owner','--no-acl','-d',database],{input:migrations});
 const grants=`grant all on schema auth,private,storage,api,extensions to postgres,supabase_storage_admin;
 grant all on all tables in schema auth,private,storage,api to postgres,supabase_storage_admin;
 grant all on all sequences in schema auth,private,storage,api to postgres,supabase_storage_admin;
 grant all on all functions in schema auth,private,storage,api to postgres,supabase_storage_admin;
 grant usage on schema storage,auth to service_role,authenticated,anon;
 grant select,insert,update,delete on all tables in schema storage to service_role,authenticated,anon;
 grant usage,select on all sequences in schema storage to service_role,authenticated,anon;
 grant execute on all functions in schema storage,auth to service_role,authenticated,anon;
 alter schema storage owner to supabase_storage_admin;
 do $$ declare r record;begin for r in select c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relkind in ('r','p','S','v','m') loop
 execute format('alter %s storage.%I owner to supabase_storage_admin',case when r.relkind='S' then 'sequence' when r.relkind='v' then 'view' when r.relkind='m' then 'materialized view' else 'table' end,r.relname);end loop;end $$;`;
 docker(['exec','-i','supabase_db_app','psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',grants]);
 scratch=new pg.Client({connectionString:target.toString()});await scratch.connect();
 if((await scratch.query('select current_database() n')).rows[0].n!==database)throw Error('TEST_SCOPE');
 const info=JSON.parse(docker(['inspect','supabase_storage_app']).toString('utf8'))[0];
 const copied=Object.fromEntries(info.Config.Env.map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 const dbUrl=new URL(copied.DATABASE_URL);dbUrl.pathname='/'+database;
 const keys=['ANON_KEY','SERVICE_KEY','AUTH_JWT_SECRET','FILE_SIZE_LIMIT','DB_MIGRATIONS_FREEZE_AT','DATABASE_URL','FILE_STORAGE_BACKEND_PATH','GLOBAL_S3_BUCKET','ENABLE_IMAGE_TRANSFORMATION','S3_PROTOCOL_ENABLED','S3_PROTOCOL_PREFIX','SIGNED_UPLOAD_URL_EXPIRATION_TIME','STORAGE_BACKEND','TENANT_ID','TUS_URL_PATH','UPLOAD_FILE_SIZE_LIMIT','UPLOAD_FILE_SIZE_LIMIT_STANDARD','JWT_JWKS','STORAGE_S3_REGION','IMAGE_TRANSFORMATION_ENABLED','VECTOR_ENABLED','STORAGE_VERSIONING_ENABLED'];
 const env={...process.env,...Object.fromEntries(keys.filter(k=>copied[k]!==undefined).map(k=>[k,copied[k]])),DATABASE_URL:dbUrl.toString(),FILE_STORAGE_BACKEND_PATH:'/tmp/z11-fixture-storage',STORAGE_VERSIONING_ENABLED:'true',VECTOR_ENABLED:'false'};
 const flags=keys.filter(k=>env[k]!==undefined).flatMap(k=>['-e',k]);
 docker(['run','-d','--rm','--name',container,'--network','supabase_network_app','-p','127.0.0.1::5000',...flags,info.Config.Image],{env});containerStarted=true;
 const mapped=docker(['port',container,'5000/tcp']).toString('utf8').trim();
 const match=/^127\.0\.0\.1:(\d+)$/.exec(mapped);if(!match)throw Error('TEST_STORAGE_PORT');
 const url='http://127.0.0.1:'+match[1],storage=new StorageClient(url,{Authorization:'Bearer '+status.SERVICE_ROLE_KEY,apikey:status.ANON_KEY});
 let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(url+'/status');if(r.status<500){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
 if(!ready)throw Error('TEST_STORAGE_START');
 const uid=randomUUID(),otherUser=randomUUID(),request=randomUUID(),job=randomUUID(),lease=randomUUID();
 await scratch.query("insert into auth.users(id,email) values($1,$2),($3,$4)",[uid,'fixture-'+uid+'@example.invalid',otherUser,'fixture-'+otherUser+'@example.invalid']);
 await scratch.query("insert into private.profiles(id,account_status) values($1,'deletion_pending'),($2,'active')",[uid,otherUser]);
 await scratch.query("insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values($1,$2,now()-interval '8 days',now()-interval '1 day','pending')",[request,uid]);
 await scratch.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4,'running','fixture',$5,now()+interval '5 minutes')",[job,request,'fixture-'+job,uid,lease]);
 await scratch.query('select private.purge_account_contributions($1,$2)',[job,lease]);
 await scratch.query('select private.purge_editorial_references($1,$2)',[job,lease]);
 const setup=`grant usage on schema private,storage to riuya_storage_inventory,riuya_storage_purger;
 grant select(bucket_id,name,owner,owner_id,is_versioned,archived_at,is_delete_marker,version) on storage.objects to riuya_storage_inventory;
 grant select,update(owner_id) on private.assets to riuya_storage_inventory;
 grant select(id,avatar_asset_id) on private.profiles to riuya_storage_inventory;
 grant select(portrait_asset_id) on private.characters to riuya_storage_inventory;
 grant select,delete on storage.objects to riuya_storage_purger;
 grant execute on function private.storage_purge_authorized() to riuya_storage_purger;
 grant create on schema private to riuya_storage_inventory;
 alter function private.purge_storage_inventory(uuid,uuid) owner to riuya_storage_inventory;
 create policy fixture_select on storage.objects for select to authenticated using(bucket_id='${bucket}' and owner_id=(current_setting('request.jwt.claims',true)::jsonb->>'sub'));
 create policy fixture_insert on storage.objects for insert to authenticated with check(bucket_id='${bucket}' and owner_id=(current_setting('request.jwt.claims',true)::jsonb->>'sub'));
 create policy fixture_update on storage.objects for update to authenticated using(bucket_id='${bucket}' and owner_id=(current_setting('request.jwt.claims',true)::jsonb->>'sub')) with check(bucket_id='${bucket}' and owner_id=(current_setting('request.jwt.claims',true)::jsonb->>'sub'));
 create policy fixture_delete on storage.objects for delete to authenticated using(bucket_id='${bucket}' and owner_id=(current_setting('request.jwt.claims',true)::jsonb->>'sub'));`;
 docker(['exec','-i','supabase_db_app','psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',setup]);
 const installed=(await scratch.query("select to_regprocedure('private.storage_purge_path_owned(text,text,text)') is not null present")).rows[0].present;
 if(!installed){
  const migration=await readFile('supabase/migrations/20261111180000_z11_storage_versions.sql','utf8');
  docker(['exec','-i','supabase_db_app','psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],{input:'BEGIN;\n'+migration+'\nCOMMIT;'});
 }
 const ownerSetup='grant create on schema private to riuya_storage_inventory; alter function private.storage_purge_path_owned(text,text,text) owner to riuya_storage_inventory;';
 docker(['exec','-i','supabase_db_app','psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',ownerSetup]);
 const legacyInstalled=(await scratch.query("select position('PURGE_STORAGE_LEGACY_OWNER_UNSUPPORTED' in pg_get_functiondef('private.purge_storage_inventory(uuid,uuid)'::regprocedure))=0 present")).rows[0].present;
 if(!legacyInstalled){
  const legacyMigration=await readFile('supabase/migrations/20261111190000_z11_storage_legacy_owner.sql','utf8');
  docker(['exec','-i','supabase_db_app','psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],{input:'BEGIN;\n'+legacyMigration+'\nCOMMIT;'});
 }
 function jwt(payload){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const a=enc({alg:'HS256',typ:'JWT'}),b=enc({...payload,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+180});return a+'.'+b+'.'+createHmac('sha256',status.JWT_SECRET).update(a+'.'+b).digest('base64url');}
 const userStore=new StorageClient(url,{Authorization:'Bearer '+jwt({role:'authenticated',sub:uid}),apikey:status.ANON_KEY});
 const otherStore=new StorageClient(url,{Authorization:'Bearer '+jwt({role:'authenticated',sub:otherUser}),apikey:status.ANON_KEY});
 const purgeStore=new StorageClient(url,{Authorization:'Bearer '+jwt({role:'riuya_storage_purger',sub:uid,purge_job:job,purge_lease:lease}),apikey:status.ANON_KEY});
 const otherAdmin=new StorageClient(url,{Authorization:'Bearer '+jwt({role:'service_role',sub:otherUser}),apikey:status.ANON_KEY});
 let r=await storage.createBucket(bucket,{public:false,versioningStatus:'ENABLED'});if(r.error)throw Error('TEST_VERSION_UNAVAILABLE '+(r.error.status||'')+' '+r.error.message);
 r=await userStore.from(bucket).upload('fixture.txt',new Blob(['uno']),{contentType:'text/plain'});if(r.error)throw Error('TEST_UPLOAD');
 r=await userStore.from(bucket).update('fixture.txt',new Blob(['dos']),{contentType:'text/plain'});if(r.error)throw Error('TEST_UPDATE');
 r=await userStore.from(bucket).remove(['fixture.txt']);if(r.error)throw Error('TEST_DELETE');
 // Dos formatos de propiedad para la misma cuenta en una única ruta ficticia.
 await scratch.query("update storage.objects set owner=$1,owner_id=null where id=(select id from storage.objects where bucket_id=$2 and name='fixture.txt' and archived_at is not null limit 1)",[uid,bucket]);
 const rows=(await scratch.query('select name,version,is_versioned,archived_at is not null archived,is_delete_marker,owner_id,owner from storage.objects where bucket_id=$1 order by created_at',[bucket])).rows;
 assert.equal(rows.length,3);assert.ok(rows.every(x=>x.version&&x.is_versioned&&(x.owner_id||x.owner)===uid));assert.equal(rows.filter(x=>x.is_delete_marker).length,1);
 r=await otherStore.from(bucket).upload('other.txt',new Blob(['otro']),{contentType:'text/plain'});if(r.error)throw Error('TEST_OTHER_UPLOAD');
 const otherVersion=(await scratch.query("select version from storage.objects where bucket_id=$1 and name='other.txt'",[bucket])).rows[0].version;
 r=await purgeStore.from(bucket).remove([{path:'other.txt',versionId:otherVersion}]);if(r.error)throw Error('TEST_OTHER_DELETE');
 assert.equal((await scratch.query("select count(*)::int n from storage.objects where bucket_id=$1 and name='other.txt'",[bucket])).rows[0].n,1);
 r=await userStore.from(bucket).upload('legacy.txt',new Blob(['antiguo']),{contentType:'text/plain'});if(r.error)throw Error('TEST_LEGACY_UPLOAD');
 // Solo metadatos ficticios en la base temporal: representa un registro antiguo.
 await scratch.query("update storage.objects set owner=$1,owner_id=null where bucket_id=$2 and name='legacy.txt'",[uid,bucket]);
 r=await userStore.from(bucket).upload('collision.txt',new Blob(['propio']),{contentType:'text/plain'});if(r.error)throw Error('TEST_COLLISION_UPLOAD');
 r=await otherAdmin.from(bucket).update('collision.txt',new Blob(['ajeno']),{contentType:'text/plain'});if(r.error)throw Error('TEST_COLLISION_UPDATE');
 const collision=(await scratch.query("select version,owner_id from storage.objects where bucket_id=$1 and name='collision.txt'",[bucket])).rows;
 assert.ok(collision.some(x=>x.owner_id===uid)&&collision.some(x=>x.owner_id===otherUser));
 const ownCollision=collision.find(x=>x.owner_id===uid),otherCollision=collision.find(x=>x.owner_id===otherUser);
 r=await purgeStore.from(bucket).remove([{path:'collision.txt',versionId:ownCollision.version}]);if(r.error)throw Error('TEST_COLLISION_DENIED');
 assert.equal((await scratch.query("select count(*)::int n from storage.objects where bucket_id=$1 and name='collision.txt'",[bucket])).rows[0].n,2);
 await assert.rejects(()=>scratch.query('select private.purge_storage_inventory($1,$2)',[job,lease]),/PURGE_STORAGE_OWNER_CONFLICT/);
 r=await storage.from(bucket).remove([{path:'collision.txt',versionId:otherCollision.version}]);if(r.error)throw Error('TEST_COLLISION_REPAIR');
 const inventory=(await scratch.query('select private.purge_storage_inventory($1,$2) objects',[job,lease])).rows[0].objects;
 assert.equal(inventory.length,5);
 assert.ok(inventory.some(x=>x.name==='legacy.txt'));
 await removePurgeObjects(purgeStore,inventory.slice(0,1));
 const resumed=(await scratch.query('select private.purge_storage_inventory($1,$2) objects',[job,lease])).rows[0].objects;
 assert.equal(resumed.length,4);
 await removePurgeObjects(purgeStore,resumed);
 await removePurgeObjects(purgeStore,resumed);
 assert.equal((await scratch.query("select count(*)::int n from storage.objects where bucket_id=$1 and name='fixture.txt'",[bucket])).rows[0].n,0);
 assert.equal((await scratch.query("select count(*)::int n from storage.objects where bucket_id=$1 and name='other.txt'",[bucket])).rows[0].n,1);
 assert.equal((await scratch.query("select count(*)::int n from storage.objects where bucket_id=$1 and name='collision.txt'",[bucket])).rows[0].n,0);
 assert.equal((await scratch.query("select count(*)::int n from storage.objects where bucket_id=$1 and name='legacy.txt'",[bucket])).rows[0].n,0);
 const plain='plain-'+suffix;
 r=await storage.createBucket(plain,{public:false});if(r.error)throw Error('TEST_PLAIN_BUCKET');
 r=await storage.from(plain).upload('fixture.txt',new Blob(['tres']),{contentType:'text/plain'});if(r.error)throw Error('TEST_PLAIN_UPLOAD');
 const single=(await scratch.query('select version from storage.objects where bucket_id=$1',[plain])).rows[0];
 if(!single?.version)throw Error('TEST_PLAIN_NO_VERSION');
 r=await storage.from(plain).remove([{path:'fixture.txt',versionId:single.version}]);if(r.error)throw Error('TEST_PLAIN_DELETE');
 assert.equal((await scratch.query('select count(*)::int n from storage.objects where bucket_id=$1',[plain])).rows[0].n,0);
 console.log('Z11 Storage aislado: versiones, propietario antiguo y conflicto entre cuentas: OK');
}finally{
 if(containerStarted){try{docker(['stop',container]);}catch{throw Error('TEST_CONTAINER_CLEANUP');}}
 if(scratch)await scratch.end().catch(()=>{});
 if(created&&baseConnected){if(!/^riuya_z11_versions_[a-f0-9]{32}$/.test(database))throw Error('TEST_SCOPE');await base.query('DROP DATABASE "'+database+'"');}
 if(baseConnected)await base.end().catch(()=>{});
}
