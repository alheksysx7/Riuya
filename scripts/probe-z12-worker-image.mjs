import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

// Esta prueba solo admite una red y una base pertenecientes al proyecto temporal.
export async function probeWorkerImage({status,id}){
 const dbUrl=new URL(status.DB_URL);
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||dbUrl.hostname!=='127.0.0.1'||dbUrl.port==='54322')throw Error('LAB_SCOPE_INVALID');
 const suffix=id.slice(-20),image='riuya-z12-worker-'+suffix+':test',container='riuya_z12_worker_'+suffix;
 const db=new pg.Client({connectionString:status.DB_URL}),pass=randomBytes(32).toString('hex'),badPass=randomBytes(32).toString('hex');
 const uid=randomUUID(),job=randomUUID(),purgeJob=randomUUID(),lateJob=randomUUID();
 const docker=(args,acceptFailure=false)=>{
  try{return {ok:true,output:execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:args[0]==='wait'?15000:240000,maxBuffer:8*1024*1024}).trim()};}
  catch(error){if(acceptFailure&&error.status===1)return {ok:false,output:''};throw Error('LAB_WORKER_IMAGE_DOCKER_FAILED');}
 };
 const url=(user,password)=>'postgresql://'+user+':'+password+'@supabase_db_'+id+':5432/postgres?sslmode=disable';
 const envArgs=(user,password)=>['-e','RIUYA_WORKER_ENABLED=1','-e','RIUYA_PURGE_ENABLED=0',
  '-e','RIUYA_WORKER_LAB_PLAINTEXT=1','-e','NOTIFICATION_TRANSPORT=local','-e','RIUYA_WORKER_DATABASE_URL='+url(user,password)];
 const rejectWorker=(user,password)=>{
  const label=user.replace('riuya_z12_','');
  if(!['unsafe','purger','direct','column','legacy','extra','service'].includes(label))throw Error('LAB_SCOPE_INVALID');
  const name='riuya_z12_reject_'+label+'_'+suffix;let created=false;
  try{
   docker(['run','-d','--name',name,'--network','supabase_network_'+id,...envArgs(user,password),image]);created=true;
   assert.equal(docker(['wait',name]).output,'1','LAB_UNSAFE_ROLE_ACCEPTED');
  }finally{
   if(created){docker(['stop','--time','2',name],true);docker(['rm',name],true);}
  }
 };
 let imageBuilt=false,started=false,containerCreated=false;
 await db.connect();
 try{
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running')")).rows[0].n,0);
  await db.query("create role riuya_z12_service login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+pass+"'");
  await db.query('grant riuya_worker_client to riuya_z12_service');
  await db.query("create role riuya_z12_unsafe login nosuperuser createdb password '"+badPass+"'");
  await db.query('grant riuya_worker_client to riuya_z12_unsafe');
  await db.query("create role riuya_z12_purger login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+badPass+"'");
  await db.query("create role riuya_z12_direct login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+badPass+"'");
  await db.query("create role riuya_z12_legacy login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+badPass+"'");
  await db.query("create role riuya_z12_extra login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+badPass+"'");
  await db.query('create role riuya_z12_func_parent nologin nosuperuser nocreatedb nocreaterole nobypassrls');
  await db.query('create role riuya_z12_parent nologin nosuperuser nocreatedb nocreaterole nobypassrls');
  await db.query("create role riuya_z12_column login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+badPass+"'");
  docker(['exec','-i','supabase_db_'+id,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
   'grant riuya_worker_client,riuya_purge_worker_client to riuya_z12_purger; grant riuya_worker_client to riuya_z12_direct,riuya_z12_column,riuya_z12_legacy,riuya_z12_extra; grant execute on function private.claim_job(text,integer) to riuya_z12_legacy; grant execute on function private.restore_unattributed_storage_present() to riuya_z12_func_parent; grant riuya_z12_func_parent to riuya_z12_extra with inherit false, set true; grant select on private.profiles to riuya_z12_direct; grant select (id) on private.profiles to riuya_z12_parent; grant riuya_z12_parent to riuya_z12_column with inherit false, set true']);

  await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'z12-image-'+randomUUID()+'@example.invalid']);
  await db.query('insert into private.profiles(id) values($1)',[uid]);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4)",[purgeJob,randomUUID(),'z12-image-purge-'+purgeJob,uid]);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'draft.generate',jsonb_build_object('fixtureId','demo-v1'),$2,$3)",[job,'z12-image-draft-'+job,uid]);
  docker(['build','-f','Dockerfile.worker','-t',image,'.']);imageBuilt=true;
  const network='supabase_network_'+id;
  for(const user of ['riuya_z12_unsafe','riuya_z12_purger','riuya_z12_direct','riuya_z12_column','riuya_z12_legacy','riuya_z12_extra'])
   rejectWorker(user,badPass);
  docker(['exec','-i','supabase_db_'+id,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
   'revoke execute on function private.schedule_notifications() from riuya_worker_client']);
  try{rejectWorker('riuya_z12_service',pass);}
  finally{docker(['exec','-i','supabase_db_'+id,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
   'grant execute on function private.schedule_notifications() to riuya_worker_client']);}
  const restricted=new pg.Client({connectionString:url('riuya_z12_service',pass).replace('supabase_db_'+id,'127.0.0.1').replace(':5432/',':'+dbUrl.port+'/')});
  await restricted.connect();
  try{
   await assert.rejects(()=>restricted.query("select private.claim_job('z12-legacy',60)"),error=>error.code==='42501');
   await assert.rejects(()=>restricted.query("select private.claim_job_filtered('z12-purge',60,true)"),error=>error.code==='42501');
  }finally{await restricted.end();}
  assert.equal((await db.query('select status from private.jobs where id=$1',[job])).rows[0].status,'queued');
  docker(['run','-d','--name',container,'--network',network,...envArgs('riuya_z12_service',pass),image]);started=true;containerCreated=true;
  let done=false;
  for(let i=0;i<100&&!done;i++){
   done=(await db.query("select exists(select 1 from private.jobs where id=$1 and status='succeeded') ok",[job])).rows[0].ok;
   if(!done)await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(done,true,'LAB_WORKER_IMAGE_NOT_COMPLETED');
  assert.equal((await db.query('select status from private.jobs where id=$1',[purgeJob])).rows[0].status,'queued');
  assert.equal((await db.query('select count(*)::int n from private.generation_runs where job_id=$1',[job])).rows[0].n,1);
  docker(['stop',container]);started=false;
  assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',container]).output,'0','LAB_WORKER_STOP_FAILED');
  docker(['rm',container]);containerCreated=false;
  // Tras arrancar sin trabajo procesable, el rol ficticio recibe un permiso indebido.
  docker(['run','-d','--name',container,'--network',network,...envArgs('riuya_z12_service',pass),image]);started=true;containerCreated=true;
  let running=false;
  for(let i=0;i<80&&!running;i++){
   running=docker(['logs',container]).output.includes('"event":"worker.start"');
   if(!running)await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(running,true,'LAB_WORKER_RECHECK_NOT_STARTED');
  docker(['exec','-i','supabase_db_'+id,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
   'grant select on private.profiles to riuya_z12_service']);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'draft.generate',jsonb_build_object('fixtureId','demo-v1'),$2,$3)",[lateJob,'z12-image-late-'+lateJob,uid]);
  let stopped=false;
  for(let i=0;i<100&&!stopped;i++){
   stopped=docker(['inspect','--format','{{.State.Running}}',container]).output==='false';
   if(!stopped)await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(stopped,true,'LAB_WORKER_RECHECK_DID_NOT_STOP');started=false;
  assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',container]).output,'1','LAB_WORKER_RECHECK_EXIT_INVALID');
  assert.equal((await db.query('select status from private.jobs where id=$1',[lateJob])).rows[0].status,'queued');
  assert.equal((await db.query('select status from private.jobs where id=$1',[purgeJob])).rows[0].status,'queued');
  await db.query('delete from private.jobs where id=$1',[lateJob]);
  docker(['rm',container]);containerCreated=false;
  console.log('Z12 laboratorio: worker restringido detiene procesamiento tras cambio de permisos: OK');
 }finally{
  if(started)docker(['stop',container]);
  if(containerCreated)docker(['rm',container]);
  if(imageBuilt)docker(['image','rm',image]);
  await db.end();
 }
}
