import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {initializePurgeJournal,initializePurgeCheckpoint,loadStoredPurgeCheckpoint} from '../src/worker/purge-journal.mjs';

// Inicia el archivo real del worker con conexiones instrumentadas al laboratorio temporal.
export async function probeLabWorkerProcess({status,dir,setupLabWorker}){
 const api=new URL(status.API_URL),dbUrl=new URL(status.DB_URL);
 if(api.hostname!=='127.0.0.1'||api.port==='54321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port==='54322'||typeof setupLabWorker!=='function')throw Error('LAB_SCOPE_INVALID');
 const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const db=new pg.Client({connectionString:status.DB_URL});
 const suffix=randomUUID().replaceAll('-',''),bucket='process-'+suffix,policy='process_'+suffix;
 const first=await admin.auth.admin.createUser({email:'z11-proc-'+suffix+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 const second=await admin.auth.admin.createUser({email:'z11-proc-other-'+suffix+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 if(first.error||second.error)throw Error('LAB_USER_CREATE');
 const uid=first.data.user.id,witness=second.data.user.id,rid=randomUUID(),jid=randomUUID();
 const working=join(dir,'worker-process'),journalDir=join(working,'journal');await mkdir(journalDir,{recursive:true});
 const journal={dir:journalDir,key:randomBytes(32),anchorPath:join(working,'journal.anchor'),checkpointPath:join(working,'journal.checkpoint')};
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 const password=randomBytes(32).toString('hex'),keyPath=join(working,'journal.key');
 await writeFile(keyPath,journal.key.toString('hex'),{flag:'wx'});
 await writeFile(join(working,'.env.worker.local'),'RIUYA_WORKER_PASSWORD='+password+'\n',{flag:'wx'});
 const cliDir=join(working,'node_modules','supabase','dist');await mkdir(cliDir,{recursive:true});
 await writeFile(join(cliDir,'supabase.js'),"process.stdout.write(process.env.RIUYA_LAB_STATUS);\n",{flag:'wx'});
 await setupLabWorker(password);
 await db.connect();
 let child;
 try{
  await db.query("insert into private.profiles(id,account_status) values($1,'deletion_pending'),($2,'active') on conflict(id) do update set account_status=excluded.account_status",[uid,witness]);
  await db.query("insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values($1,$2,now()-interval '8 days',now()-interval '1 day','pending')",[rid,uid]);
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running')")).rows[0].n,0);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4)",[jid,rid,'process-'+jid,uid]);
  const created=await admin.storage.createBucket(bucket,{public:false});if(created.error)throw Error('LAB_BUCKET_CREATE');
  await db.query(`create policy ${policy} on storage.objects for insert to authenticated with check (bucket_id = '${bucket}' and owner_id = (current_setting('request.jwt.claims',true)::jsonb->>'sub'))`);
  const jwt=sub=>{const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),a=enc({alg:'HS256',typ:'JWT'}),b=enc({role:'authenticated',sub,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+180});return a+'.'+b+'.'+createHmac('sha256',status.JWT_SECRET).update(a+'.'+b).digest('base64url');};
  for(const [owner,path] of [[uid,'own.txt'],[witness,'witness.txt']]){
   const scoped=createClient(status.API_URL,status.ANON_KEY,{global:{headers:{Authorization:'Bearer '+jwt(owner)}},auth:{persistSession:false,autoRefreshToken:false}});
   if((await scoped.storage.from(bucket).upload(path,new Blob(['worker fixture']),{contentType:'text/plain'})).error)throw Error('LAB_UPLOAD');
  }
  const workerUrl=new URL(status.DB_URL);workerUrl.username='riuya_worker_local';workerUrl.password=password;
  const fakeStatus={...status,API_URL:'http://127.0.0.1:54321',DB_URL:'postgresql://fixture:fixture@127.0.0.1:54322/postgres'};
  const workerEntry=resolve('scripts/worker-local.mjs'),preload=resolve('scripts/probe-z11-worker-preload.mjs');
  child=spawn(process.execPath,['--import',pathToFileURL(preload).href,workerEntry],{
   cwd:working,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,
    RIUYA_LAB_APP_ENTRY:workerEntry,RIUYA_LAB_WORKER_DB:workerUrl.toString(),RIUYA_LAB_API:status.API_URL,RIUYA_LAB_STATUS:JSON.stringify(fakeStatus),
    RIUYA_WORKER_PASSWORD:password,RIUYA_PURGE_ENABLED:'1',NOTIFICATION_TRANSPORT:'local',
    RIUYA_PURGE_JOURNAL_DIR:journal.dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath}});
  let output='',err='',exited=false,exitCode;
  child.stdout.on('data',chunk=>{output+=chunk.toString();});
  child.stderr.on('data',chunk=>{err+=chunk.toString();});
  const exit=new Promise(resolve=>child.on('exit',(code)=>{exited=true;exitCode=code;resolve();}));
  const purgeCompleted=()=>output.split('\n').some(line=>{try{const event=JSON.parse(line);return event.event==='worker.job'&&event.type==='account.purge'&&event.status==='completed';}catch{return false;}});
  let firstLease,renewed=false;
  for(let i=0;i<160&&!purgeCompleted()&&!exited;i++){
   const row=(await db.query('select status,lease_until from private.jobs where id=$1',[jid])).rows[0];
   if(row?.status==='running'&&row.lease_until){const t=new Date(row.lease_until).getTime();if(!firstLease)firstLease=t;else if(t>firstLease+5000)renewed=true;}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!purgeCompleted())throw Error('LAB_PROCESS_FAILED '+(exited?'exit '+exitCode:'timeout')+' '+err.slice(0,600));
  assert.equal(renewed,true);
  child.send('stop');await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('LAB_PROCESS_STOP_TIMEOUT')),7000))]);
  assert.equal(exitCode,0);child=null;
  assert.equal((await admin.auth.admin.getUserById(uid)).error?.status,404);
  assert.equal((await admin.auth.admin.getUserById(witness)).error,null);
  assert.ok((await admin.storage.from(bucket).download('own.txt')).error);
  assert.equal((await admin.storage.from(bucket).download('witness.txt')).error,null);
  assert.deepEqual((await db.query('select stage,user_id from private.account_purge_operations where job_id=$1',[jid])).rows[0],{stage:'finalized',user_id:null});
  assert.equal((await loadStoredPurgeCheckpoint(journal)).count,1);
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  await db.end();
 }
}
