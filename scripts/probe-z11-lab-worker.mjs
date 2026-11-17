import assert from 'node:assert/strict';
import {randomUUID,createHmac,randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {initializePurgeJournal,initializePurgeCheckpoint,loadStoredPurgeCheckpoint} from '../src/worker/purge-journal.mjs';
import {createLocalPurgeAuthAdmin} from '../src/worker/purge-auth.mjs';
import {processAccountPurge} from '../src/worker/purge-account.mjs';
import {runWorkerTick} from '../src/worker/worker-tick.mjs';
import {runWithPurgeHeartbeat} from '../src/worker/purge-heartbeat.mjs';

// Solo invocado por el laboratorio efímero: redirige cada petición del handler
// a su gateway y rechaza cualquier otro destino durante el ciclo de prueba.
export async function probeLabWorker({status,dir,grantLabRoles}){
 const url=new URL(status.API_URL),dbUrl=new URL(status.DB_URL);
 if(url.hostname!=='127.0.0.1'||url.port==='54321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port==='54322'||typeof grantLabRoles!=='function')throw Error('LAB_SCOPE_INVALID');
 const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const db=new pg.Client({connectionString:status.DB_URL});
 const suffix=randomUUID().replaceAll('-',''),bucket='z11-lab-'+suffix,policy='lab_'+suffix;
 const user=await admin.auth.admin.createUser({email:'z11-lab-worker-'+suffix+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 const witness=await admin.auth.admin.createUser({email:'z11-lab-other-'+suffix+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 if(user.error||witness.error)throw Error('LAB_USER_CREATE');
 const uid=user.data.user.id,other=witness.data.user.id,rid=randomUUID(),jid=randomUUID();
 const journalDir=join(dir,'worker-journal');await mkdir(journalDir);
 const journal={dir:journalDir,key:randomBytes(32),anchorPath:join(dir,'worker.anchor'),checkpointPath:join(dir,'worker.checkpoint')};
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);
 await db.connect();
 try{
  await grantLabRoles();
  await db.query("insert into private.profiles(id,account_status) values($1,'deletion_pending'),($2,'active') on conflict(id) do update set account_status=excluded.account_status",[uid,other]);
  await db.query("insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values($1,$2,now()-interval '8 days',now()-interval '1 day','pending')",[rid,uid]);
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running')")).rows[0].n,0);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'account.purge',jsonb_build_object('requestId',$2::text),$3,$4)",[jid,rid,'lab-'+jid,uid]);
  let storageReady=false;
  for(let i=0;i<50&&!storageReady;i++){
   const check=await admin.storage.listBuckets();storageReady=!check.error;
   if(!storageReady)await new Promise(resolve=>setTimeout(resolve,300));
  }
  if(!storageReady)throw Error('LAB_STORAGE_NOT_READY');
  const b=await admin.storage.createBucket(bucket,{public:false});if(b.error)throw Error('LAB_BUCKET_CREATE_'+(b.error.status||'UNKNOWN'));
  await db.query(`create policy ${policy} on storage.objects for insert to authenticated with check (bucket_id = '${bucket}' and owner_id = (current_setting('request.jwt.claims',true)::jsonb->>'sub'))`);
  const token=(sub)=>{
   const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
   const a=enc({alg:'HS256',typ:'JWT'}),b=enc({role:'authenticated',sub,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+180});
   return a+'.'+b+'.'+createHmac('sha256',status.JWT_SECRET).update(a+'.'+b).digest('base64url');
  };
  const scoped=sub=>createClient(status.API_URL,status.ANON_KEY,{global:{headers:{Authorization:'Bearer '+token(sub)}},auth:{persistSession:false,autoRefreshToken:false}});
  for(const [sub,path] of [[uid,'own.txt'],[other,'witness.txt']]){
   const result=await scoped(sub).storage.from(bucket).upload(path,new Blob(['fixture']),{contentType:'text/plain'});
   if(result.error)throw Error('LAB_STORAGE_UPLOAD');
  }
  const asRole=role=>({async query(sql,args){await db.query('begin');try{await db.query('set local role '+role);const value=await db.query(sql,args);await db.query('commit');return value;}catch(e){await db.query('rollback');throw e;}}});
  const queue=asRole('riuya_worker_client'),executor=asRole('riuya_purge_worker_client');
  const originalFetch=globalThis.fetch,errors=[];
  globalThis.fetch=async(input,options)=>{
   const source=new URL(typeof input==='string'?input:input.url);
   if(source.origin!=='http://127.0.0.1:54321')throw Error('LAB_NETWORK_SCOPE');
   const target=new URL(source.pathname+source.search,status.API_URL);
   return originalFetch(target,options);
  };
  try{
   const purgeAdmin=createLocalPurgeAuthAdmin({apiUrl:'http://127.0.0.1:54321',serviceRoleKey:status.SERVICE_ROLE_KEY});
   let renewals=0,notifyRenewed;
   const renewed=new Promise(resolve=>{notifyRenewed=resolve;});
   const worked=await runWorkerTick({client:queue,worker:'isolated-lab',purgeEnabled:true,onError:(...args)=>errors.push(args),
    processJob:async job=>{
     const heartClient=new pg.Client({connectionString:status.DB_URL});
     const heart={
      async connect(){await heartClient.connect();await heartClient.query('set role riuya_worker_client');},
      async query(sql,args){const result=await heartClient.query(sql,args);if(result.rows[0]?.ok){renewals++;notifyRenewed();}return result;},
      async end(){await heartClient.end();}
     };
     return runWithPurgeHeartbeat({heart,job,intervalMs:50,run:async()=>{
      await Promise.race([renewed,new Promise((_,reject)=>setTimeout(()=>reject(Error('LAB_RENEWAL_TIMEOUT')),3000))]);
      await processAccountPurge({db:executor,job,admin:purgeAdmin,journal,storageConfig:{apiUrl:'http://127.0.0.1:54321',anonKey:status.ANON_KEY,jwtSecret:status.JWT_SECRET}});
     }});
    }});
   assert.equal(worked,true);assert.deepEqual(errors,[]);assert.ok(renewals>=1);
  }finally{globalThis.fetch=originalFetch;}
  assert.equal((await admin.auth.admin.getUserById(uid)).error?.status,404);
  assert.equal((await admin.auth.admin.getUserById(other)).error,null);
  assert.ok((await admin.storage.from(bucket).download('own.txt')).error);
  assert.equal((await admin.storage.from(bucket).download('witness.txt')).error,null);
  const state=(await db.query('select stage,user_id from private.account_purge_operations where job_id=$1',[jid])).rows[0];
  assert.deepEqual(state,{stage:'finalized',user_id:null});
  assert.equal((await loadStoredPurgeCheckpoint(journal)).count,1);
 }finally{await db.end();}
}
