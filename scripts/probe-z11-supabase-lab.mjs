import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHmac,createCipheriv,createDecipheriv,scryptSync} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,cp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute,sep} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';
import {initializePurgeJournal,initializePurgeCheckpoint,recordPurgeIntent} from '../src/worker/purge-journal.mjs';
import {runLocalRestore} from '../src/worker/purge-restore-runner.mjs';
import {checkRecoveryReadiness} from '../src/worker/purge-recovery-readiness.mjs';
import {probeLabWorker} from './probe-z11-lab-worker.mjs';
import {probeLabWorkerProcess} from './probe-z11-worker-process.mjs';
import {probeLabAssetMappingRace} from './probe-z11-asset-mapping-race.mjs';
import {probeLabRestoreOrphan} from './probe-z11-restore-orphan.mjs';
import {createRestoreInternalFetch} from '../src/worker/purge-restore-internal-fetch.mjs';
import {probeResticFixture} from './probe-z11-restic-fixture.mjs';
import {probeLabEditorial} from './probe-z12-lab-editorial.mjs';
import {probeLabEditorialUi} from './probe-z12-lab-editorial-ui.mjs';
import {probeWorkerImage} from './probe-z12-worker-image.mjs';
import {probeWorkerTlsDb} from './probe-z12-worker-tls-db.mjs';
import {probeWorkerTlsImage} from './probe-z12-worker-tls-image.mjs';
import {probeWorkerRace} from './probe-z12-worker-race.mjs';
import {probeLoad} from './probe-z12-load.mjs';
import {probeDiagnostics} from './probe-z12-diagnostics.mjs';

const id='riuya_z11_lab_'+randomUUID().replaceAll('-','').slice(0,20);
if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id))throw Error('LAB_SCOPE_INVALID');
const dir=await mkdtemp(join(tmpdir(),'riuya-z11-lab-'));
const resolvedTemp=await realpath(tmpdir()),resolvedDir=await realpath(dir),rel=relative(resolvedTemp,resolvedDir);
if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!rel.startsWith('riuya-z11-lab-'))throw Error('LAB_SCOPE_INVALID');
const cli=join(process.cwd(),'node_modules','supabase','dist','supabase.js');
const port=()=>new Promise((resolve,reject)=>{
 const server=createServer();server.once('error',reject);
 server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value));});
});
const replacements=new Map();
for(let i=54320;i<=54329;i++)replacements.set(String(i),String(await port()));
let config=await readFile('supabase/config.toml','utf8');
if(!/\[db\.seed\]\s*\n[^\[]*?enabled = false/.test(config))throw Error('LAB_SEED_CONFIG_INVALID');
config=config.replace(/^project_id = "app"$/m,'project_id = "'+id+'"')
 .replace(/\b5432[0-9]\b/g,value=>replacements.get(value));
// La carga crea sesiones de prueba, no mide el límite de inicios de sesión.
if(process.env.RIUYA_LAB_LOAD_WEB==='1'){
 if(!/^sign_in_sign_ups = 30$/m.test(config))throw Error('LAB_AUTH_LIMIT_CONFIG_INVALID');
 config=config.replace(/^sign_in_sign_ups = 30$/m,'sign_in_sign_ups = 300');
}
if(!config.includes('project_id = "'+id+'"')||!config.includes('port = '+replacements.get('54321')))throw Error('LAB_CONFIG_INVALID');
await mkdir(join(dir,'supabase'));
await writeFile(join(dir,'supabase','config.toml'),config);
await cp('supabase/migrations',join(dir,'supabase','migrations'),{recursive:true,errorOnExist:true,force:false});
function run(args){
 try{return execFileSync(process.execPath,[cli,...args,'--workdir',dir],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});}
 catch(e){throw Error('LAB_CLI_FAILED '+args[0]+' exit='+(e.status??'timeout'));}
}
let cleanupOk=false;
try{
 run(['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector']);
 const status=JSON.parse(run(['status','-o','json']));
 const expected='http://127.0.0.1:'+replacements.get('54321');
 assert.equal(status.API_URL,expected);
 assert.ok(status.DB_URL.includes('127.0.0.1:'+replacements.get('54322')));
 const client=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const anon=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const characters=await anon.schema('api').rpc('list_characters'),categories=await anon.schema('api').rpc('list_categories');
 assert.equal(characters.error,null);assert.equal(categories.error,null);
 assert.deepEqual(characters.data.map(value=>value.stable_key),['rami','beatriz','leo','dmitri','naoki','salma','tove','kavya']);
 assert.equal(categories.data.length,6);
 console.log('Z12 reconstrucción aislada: ocho voces y seis categorías desde migraciones: OK');
 const accentDb=new pg.Client({connectionString:status.DB_URL});
 await accentDb.connect();
 try{
  await accentDb.query(await readFile('scripts/test-z12-health.sql','utf8'));
  await accentDb.query(await readFile('scripts/test-z12-emotion-accent.sql','utf8'));
 }
 catch(error){
  await accentDb.query('rollback');
  const access=await accentDb.query("select p.proacl::text acl, pg_has_role('anon','riuya_reader_executor','USAGE') reader_role, pg_has_role('anon','riuya_results_executor','USAGE') results_role, has_schema_privilege('anon','private','USAGE') schema_usage from pg_proc p where p.oid='private.reader_emotion_accent(uuid)'::regprocedure");
  console.error('Z12 acentos: fallo SQL '+error.code+' '+error.message+' '+JSON.stringify(access.rows[0]));throw error;
 }
 finally{await accentDb.end();}
 console.log('Z12 acentos: validación, privacidad, dominante y retirada: OK');


 const email='z11-lab-'+randomUUID()+'@example.invalid';
 const created=await client.auth.admin.createUser({email,password:randomUUID()+'Aa1!',email_confirm:true});
 assert.equal(created.error,null);assert.ok(created.data.user?.id);
 const fetched=await client.auth.admin.getUserById(created.data.user.id);
 assert.equal(fetched.data.user?.email,email);
 const witness=await client.auth.admin.createUser({email:'z11-witness-'+randomUUID()+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 assert.equal(witness.error,null);
 const uid=created.data.user.id,witnessId=witness.data.user.id,requestId=randomUUID();
 const journalDir=join(dir,'journal');await mkdir(journalDir);
 const journal={dir:journalDir,key:randomBytes(32),anchorPath:join(dir,'journal.anchor'),checkpointPath:join(dir,'journal.checkpoint')};
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 const journalKeyPath=join(dir,'journal.key');await writeFile(journalKeyPath,journal.key.toString('hex'),{flag:'wx'});
 let db=new pg.Client({connectionString:status.DB_URL});
 await db.connect();
 await db.query('insert into private.profiles(id) values($1),($2) on conflict(id) do nothing',[uid,witnessId]);
 const suffix=randomUUID().replaceAll('-',''),bucket='restore-'+suffix,policy='restore_'+suffix;
 const made=await client.storage.createBucket(bucket,{public:false});if(made.error)throw Error('LAB_RESTORE_BUCKET');
 await db.query(`create policy ${policy} on storage.objects for insert to authenticated with check (bucket_id = '${bucket}' and owner_id = (current_setting('request.jwt.claims',true)::jsonb->>'sub'))`);
 const jwt=sub=>{
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const a=enc({alg:'HS256',typ:'JWT'}),b=enc({role:'authenticated',sub,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+180});
  return a+'.'+b+'.'+createHmac('sha256',status.JWT_SECRET).update(a+'.'+b).digest('base64url');
 };
 for(const [owner,name] of [[uid,'own.txt'],[witnessId,'witness.txt']]){
  const scoped=createClient(status.API_URL,status.ANON_KEY,{global:{headers:{Authorization:'Bearer '+jwt(owner)}},auth:{persistSession:false,autoRefreshToken:false}});
  if((await scoped.storage.from(bucket).upload(name,new Blob(['backup-fixture']),{contentType:'text/plain'})).error)throw Error('LAB_RESTORE_UPLOAD');
 }
 await db.end();db=null;
 const docker=(args,options={})=>{try{return execFileSync('docker',args,{encoding:null,stdio:['pipe','pipe','pipe'],windowsHide:true,maxBuffer:128*1024*1024,...options});}catch(e){throw Error('LAB_DOCKER_FAILED '+(args[2]||args[0])+' exit='+(e.status??'unknown'));}};
 const labDb='supabase_db_'+id,services=['supabase_kong_'+id,'supabase_rest_'+id,'supabase_storage_'+id,'supabase_auth_'+id];
 if(!/^supabase_db_riuya_z11_lab_[a-f0-9]{20}$/.test(labDb)||services.some(name=>!name.endsWith('_'+id)))throw Error('LAB_SCOPE_INVALID');
 const assetSql=await readFile('scripts/test-z11-asset-purge.sql','utf8');
 docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:assetSql});
 // Solo para el laboratorio: rechazar la captura si cualquiera de sus servicios
 // conocidos sigue encendido. No identifica otros procesos ni conexiones externas.
 const requireStoppedLabServices=()=>{
  for(const service of services){
   if(docker(['inspect','--format','{{.State.Running}}',service]).toString('utf8').trim()!=='false')throw Error('LAB_BACKUP_NOT_QUIESCED');
  }
 };
 assert.throws(requireStoppedLabServices,/LAB_BACKUP_NOT_QUIESCED/);
 docker(['stop',...services]);
 requireStoppedLabServices();
 const storageVolume='supabase_storage_'+id;
 const image='public.ecr.aws/supabase/postgres:17.11.0.011';
 const labVolumeReader='riuya_z11_volume_probe_'+id.slice(-20);
 if(!/^riuya_z11_volume_probe_[a-f0-9]{20}$/.test(labVolumeReader))throw Error('LAB_SCOPE_INVALID');
 // Consulta puntual: no impide montajes posteriores ni acceso desde el host.
 const requireNoLabVolumeConsumers=()=>{
  const consumers=docker(['ps','--filter','volume='+storageVolume,'--format','{{.ID}}']).toString('utf8').trim();
  if(consumers)throw Error('LAB_BACKUP_VOLUME_IN_USE');
 };
 requireNoLabVolumeConsumers();
 docker(['run','-d','--rm','--network','none','--name',labVolumeReader,'--mount','type=volume,src='+storageVolume+',dst=/store,readonly',image,'sleep','120']);
 try{assert.throws(requireNoLabVolumeConsumers,/LAB_BACKUP_VOLUME_IN_USE/);}
 finally{docker(['stop',labVolumeReader]);}
 requireNoLabVolumeConsumers();
 // Instantánea de conexiones cliente a la base ficticia; no impide conexiones nuevas.
 const requireNoLabClients=()=>{
  const count=docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',
   "select count(*) from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid()"]).toString('utf8').trim();
  if(!/^\d+$/.test(count))throw Error('LAB_BACKUP_CLIENT_CHECK_UNKNOWN');
  if(count!=='0')throw Error('LAB_BACKUP_CLIENTS_PRESENT');
 };
 const concurrentClient=new pg.Client({connectionString:status.DB_URL});
 await concurrentClient.connect();
 try{assert.throws(requireNoLabClients,/LAB_BACKUP_CLIENTS_PRESENT/);}finally{await concurrentClient.end();}
 requireNoLabClients();
 // El bloqueo ALLOW_CONNECTIONS se ensaya únicamente en la base temporal.
 // Las sesiones existentes sobreviven; pg_dump también queda sin poder conectar.
 const existingAdmin=new pg.Client({connectionString:status.DB_URL});
 await existingAdmin.connect();
 try{
  const readAllow=()=>docker(['exec','-i',labDb,'psql','-U','postgres','-d','template1','-At','-v','ON_ERROR_STOP=1','-c',
   "select datallowconn from pg_database where datname='postgres'"]).toString('utf8').trim();
  const originalAllow=readAllow();
  assert.equal(originalAllow,'t');
  try{
   docker(['exec','-i',labDb,'psql','-U','postgres','-d','template1','-v','ON_ERROR_STOP=1','-c','alter database postgres allow_connections false']);
   assert.equal(readAllow(),'f');
   const blockedAdmin=new pg.Client({connectionString:status.DB_URL,connectionTimeoutMillis:5000});
   try{await assert.rejects(()=>blockedAdmin.connect(),error=>error.code==='55000');}
   finally{await blockedAdmin.end();}
   assert.equal((await existingAdmin.query('select 1 as value')).rows[0].value,1);
  }finally{
   docker(['exec','-i',labDb,'psql','-U','postgres','-d','template1','-v','ON_ERROR_STOP=1','-c','alter database postgres allow_connections true']);
   assert.equal(readAllow(),originalAllow);
  }
 }finally{await existingAdmin.end();}
 const afterBlockAdmin=new pg.Client({connectionString:status.DB_URL});
 try{await afterBlockAdmin.connect();}finally{await afterBlockAdmin.end();}
 requireNoLabClients();
 // Solo el rol ficticio sin privilegios especiales se somete a esta prueba.
 const labClientPassword=randomBytes(32).toString('hex');
 docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',
  "create role riuya_lab_capture_client login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '"+labClientPassword+"'"]);
 const limitedUrl=new URL(status.DB_URL);limitedUrl.username='riuya_lab_capture_client';limitedUrl.password=labClientPassword;
 const connectLimited=async()=>{
  const c=new pg.Client({connectionString:limitedUrl.toString(),connectionTimeoutMillis:5000});
  try{await c.connect();}finally{await c.end();}
 };
 await connectLimited();
 // Ensayo de restauración ante una excepción recuperable del proceso, no ante corte eléctrico.
 const permissionClient=new pg.Client({connectionString:status.DB_URL});
 await permissionClient.connect();
 try{
  const acl=async()=>(await permissionClient.query(`select x.grantor::text, x.grantee::text, x.privilege_type, x.is_grantable
   from pg_database d cross join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) x
   where d.datname=current_database() order by 1,2,3,4`)).rows;
  const withLabPublicRestriction=async action=>{
   const before=await acl(),publicConnect=before.find(x=>x.grantee==='0'&&x.privilege_type==='CONNECT');
   await permissionClient.query('revoke connect on database postgres from public');
   try{return await action();}
   finally{
    if(publicConnect)await permissionClient.query('grant connect on database postgres to public'+(publicConnect.is_grantable?' with grant option':''));
    assert.deepEqual(await acl(),before);
   }
  };
  const baseline=await acl();
  await assert.rejects(()=>withLabPublicRestriction(async()=>{throw Error('LAB_SIMULATED_CAPTURE_FAILURE');}),/LAB_SIMULATED_CAPTURE_FAILURE/);
  await connectLimited();
  await permissionClient.query('revoke connect on database postgres from public');
  try{
   await assert.rejects(()=>withLabPublicRestriction(async()=>{throw Error('LAB_SIMULATED_CAPTURE_FAILURE');}),/LAB_SIMULATED_CAPTURE_FAILURE/);
   await assert.rejects(connectLimited,error=>error.code==='42501');
  }finally{
   await permissionClient.query('grant connect on database postgres to public');
  }
  assert.deepEqual(await acl(),baseline);
 }finally{await permissionClient.end();}
 requireNoLabClients();
 docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','revoke connect on database postgres from public']);
 await assert.rejects(connectLimited,error=>error.code==='42501');
 // Un permiso directo permite el acceso incluso si PUBLIC no puede conectar.
 docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','grant connect on database postgres to riuya_lab_capture_client']);
 await connectLimited();
 docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','revoke connect on database postgres from riuya_lab_capture_client']);
 await assert.rejects(connectLimited,error=>error.code==='42501');
 requireNoLabClients();
 // El respaldo solo contiene las cuentas creadas en este laboratorio desechable.
 const backup=docker(['exec','-i',labDb,'pg_dump','-U','supabase_admin','-Fc','-C','postgres']);
 requireNoLabVolumeConsumers();
 const archive=docker(['run','--rm','--network','none','--mount','type=volume,src='+storageVolume+',dst=/store',image,'tar','-cf','-','-C','/store','.']);
 // Alternativa experimental: repositorio cifrado dentro del laboratorio ficticio.
 const resticCopy=process.env.RIUYA_LAB_RESTIC_EXE
  ?probeResticFixture({executable:process.env.RIUYA_LAB_RESTIC_EXE,dir,id,image}):null;
 if(resticCopy&&(!resticCopy.database.length||!resticCopy.storage.length))throw Error('LAB_RESTIC_EMPTY');
 // Prototipo exclusivo del laboratorio: no es una herramienta de respaldo operativo.
 // La clave y los datos son ficticios; el archivo se crea en el directorio temporal del laboratorio.
 const password=randomBytes(32),salt=randomBytes(16),iv=randomBytes(12);
 const key=scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const payload=Buffer.from(JSON.stringify({database:backup.toString('base64'),storage:archive.toString('base64')}));
 const cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('riuya-z11-lab-backup-v1'));
 const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
 const envelope=Buffer.from(JSON.stringify({salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));
 const backupPath=join(dir,'fixture-backup.enc');await writeFile(backupPath,envelope,{flag:'wx'});
 await assert.rejects(()=>writeFile(backupPath,envelope,{flag:'wx'}));
 const openFixture=(raw,secret)=>{
  const obj=JSON.parse(raw.toString('utf8'));
  const derived=scryptSync(secret,Buffer.from(obj.salt,'base64'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  const decipher=createDecipheriv('aes-256-gcm',derived,Buffer.from(obj.iv,'base64'));
  decipher.setAAD(Buffer.from('riuya-z11-lab-backup-v1'));decipher.setAuthTag(Buffer.from(obj.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(obj.data,'base64')),decipher.final()]).toString('utf8'));
 };
 const saved=await readFile(backupPath);
 assert.throws(()=>openFixture(saved,randomBytes(32)));
 const damaged=JSON.parse(saved.toString('utf8')),damagedData=Buffer.from(damaged.data,'base64');
 damagedData[0]^=1;damaged.data=damagedData.toString('base64');
 assert.throws(()=>openFixture(Buffer.from(JSON.stringify(damaged)),password));
 const opened=openFixture(saved,password),restoredDatabase=Buffer.from(opened.database,'base64'),restoredStorage=Buffer.from(opened.storage,'base64');
 assert.deepEqual(restoredDatabase,backup);assert.deepEqual(restoredStorage,archive);
 requireStoppedLabServices();
 requireNoLabClients();
 requireNoLabVolumeConsumers();
 await assert.rejects(connectLimited,error=>error.code==='42501');
 docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','grant connect on database postgres to public']);
 await connectLimited();
 docker(['start',...services]);
 let captureServicesReady=false;
 for(let i=0;i<50&&!captureServicesReady;i++){
  try{captureServicesReady=(await fetch(status.API_URL+'/auth/v1/health',{signal:AbortSignal.timeout(1000)})).ok&&(await fetch(status.API_URL+'/storage/v1/status',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  if(!captureServicesReady)await new Promise(resolve=>setTimeout(resolve,300));
 }
 if(!captureServicesReady)throw Error('LAB_CAPTURE_SERVICES_NOT_READY');
 const removed=await client.storage.from(bucket).remove(['own.txt','witness.txt']);if(removed.error)throw Error('LAB_REMOVE_BEFORE_RESTORE');
 assert.ok((await client.storage.from(bucket).download('witness.txt')).error);
 await recordPurgeIntent({...journal,requireCheckpoint:true,requestId,userId:uid});
 docker(['stop',...services]);
 await assert.rejects(()=>fetch(status.API_URL+'/auth/v1/health',{signal:AbortSignal.timeout(2000)}));
 // La base afectada es exclusivamente la del contenedor temporal de nombre validado.
 docker(['exec','-i',labDb,'dropdb','-U','supabase_admin','--force','--if-exists','postgres']);
 docker(['exec','-i',labDb,'pg_restore','-U','supabase_admin','--exit-on-error','-C','-d','template1'],{input:resticCopy?.database||restoredDatabase});
 // El volcado capturó la restricción temporal; se restablece solo en esta base ficticia.
 docker(['exec','-i',labDb,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','grant connect on database postgres to public']);
 docker(['run','--rm','-i','--network','none','--mount','type=volume,src='+storageVolume+',dst=/store',image,'tar','-xf','-','-C','/store'],{input:resticCopy?.storage||restoredStorage});
 // Solo servicios internos; Kong y REST siguen detenidos.
 docker(['start','supabase_storage_'+id,'supabase_auth_'+id]);
 db=new pg.Client({connectionString:status.DB_URL});
 try{
  await db.connect();
  const bridge=createRestoreInternalFetch({projectId:id});
  let internalReady=false;
  for(let i=0;i<50&&!internalReady;i++){
   try{internalReady=(await bridge('http://127.0.0.1:54321/auth/v1/health')).ok&&(await bridge('http://127.0.0.1:54321/storage/v1/status')).ok;}catch{}
   if(!internalReady)await new Promise(resolve=>setTimeout(resolve,300));
  }
  if(!internalReady)throw Error('LAB_INTERNAL_SERVICES_NOT_READY');
  docker(['exec','-i',labDb,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
   'grant riuya_worker_client,riuya_purge_worker_client to postgres with inherit false, set true']);
  const checkLabIsolation=async()=>{
   const kong=docker(['inspect','--format','{{.State.Running}}','supabase_kong_'+id]).toString('utf8').trim();
   const rest=docker(['inspect','--format','{{.State.Running}}','supabase_rest_'+id]).toString('utf8').trim();
   return {blocked:kong!=='false'||rest!=='false'};
  };
  const fakeUrl='postgresql://fixture:fixture@127.0.0.1:54322/postgres';
  const env={RIUYA_PURGE_JOURNAL_DIR:journal.dir,RIUYA_PURGE_JOURNAL_KEY_FILE:journalKeyPath,
   RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath,
   RIUYA_RESTORE_AUDIT_DATABASE_URL:fakeUrl,RIUYA_RESTORE_CONTROL_DATABASE_URL:fakeUrl,
   RIUYA_RESTORE_WORKER_DATABASE_URL:fakeUrl,RIUYA_RESTORE_QUEUE_DATABASE_URL:fakeUrl,
   RIUYA_RESTORE_ANON_KEY:status.ANON_KEY,RIUYA_RESTORE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,RIUYA_RESTORE_JWT_SECRET:status.JWT_SECRET};
  const labOptions={env,projectId:id,clientFactory:()=>new pg.Client({connectionString:status.DB_URL}),checkIsolation:checkLabIsolation,checkCustody:()=>{}};
  const before=await checkRecoveryReadiness(labOptions);assert.equal(before.checksPassed,false);assert.equal(before.report.remaining,1);
  const report=await runLocalRestore({...labOptions,offline:true});
  assert.deepEqual(report,{recorded:1,remaining:0,cleared:1,inconsistent:0,ready:true});
  const after=await checkRecoveryReadiness(labOptions);assert.equal(after.checksPassed,true);assert.equal(after.report.cleared,1);
  assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[witnessId])).rows[0].n,1);
  await assert.rejects(()=>fetch(status.API_URL+'/auth/v1/health',{signal:AbortSignal.timeout(2000)}));
 }finally{await db.end();}
 docker(['start','supabase_kong_'+id,'supabase_rest_'+id]);
 let ready=false;
 for(let i=0;i<50&&!ready;i++){
  try{ready=(await fetch(status.API_URL+'/auth/v1/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  if(!ready)await new Promise(resolve=>setTimeout(resolve,300));
 }
 assert.equal(ready,true);
 assert.equal((await client.auth.admin.getUserById(uid)).error?.status,404);
 assert.equal((await client.auth.admin.getUserById(witnessId)).error,null);
 assert.ok((await client.storage.from(bucket).download('own.txt')).error);
 const restored=await client.storage.from(bucket).download('witness.txt');assert.equal(restored.error,null);assert.equal(await restored.data.text(),'backup-fixture');
 const grantLabRoles=async()=>{
  docker(['exec','-i',labDb,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
   'grant riuya_worker_client,riuya_purge_worker_client to postgres with inherit false, set true']);
 };
 await probeLabWorker({status,dir,grantLabRoles});
 const setupLabWorker=async password=>{
  if(!/^[a-f0-9]{64}$/.test(password))throw Error('LAB_PASSWORD_INVALID');
  const sql=`do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_worker_local') then create role riuya_worker_local login nosuperuser nocreatedb nocreaterole inherit nobypassrls; end if; end $$; alter role riuya_worker_local password '${password}'; grant riuya_worker_client,riuya_purge_worker_client to riuya_worker_local with inherit true, set true;`;
  docker(['exec','-i',labDb,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql});
 };
 await probeLabWorkerProcess({status,dir,setupLabWorker});
 await probeLabEditorial({status,dir,setupLabWorker});
 await probeLabEditorialUi({status,dir,id,appPort:await port(),setupLabWorker});
 await probeLabAssetMappingRace({status});
 await probeLabRestoreOrphan({status,dir});
 await probeWorkerImage({status,id});
 await probeWorkerTlsDb({status,dir,id});
 await probeWorkerTlsImage({status,dir,id});
 await probeWorkerRace({status,id});
 await probeDiagnostics({status,id});
 if(process.env.RIUYA_LAB_LOAD==='1')await probeLoad({status,id});
 if(resticCopy)console.log('Z11 laboratorio: restauración desde restic de base y Storage ficticios: OK');
 console.log('Z11 laboratorio: restauración y proceso worker aislado con Auth y Storage reales: OK');
}finally{
 // La CLI recibe exclusivamente el identificador aleatorio comprobado arriba.
 run(['stop','--project-id',id,'--no-backup']);
 const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
 if(docker(['ps','-a','--filter','name='+id,'--format','{{.Names}}'])||docker(['volume','ls','--filter','name='+id,'--format','{{.Name}}']))throw Error('LAB_CLEANUP_INCOMPLETE');
 cleanupOk=true;
 if(cleanupOk){
  const now=await realpath(dir);
  if(now!==resolvedDir)throw Error('LAB_SCOPE_INVALID');
  await rm(now,{recursive:true,force:false});
 }
}
