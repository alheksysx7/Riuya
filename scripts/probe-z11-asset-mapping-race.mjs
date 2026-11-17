import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';

export async function probeLabAssetMappingRace({status}){
 const url=new URL(status.API_URL),dbUrl=new URL(status.DB_URL);
 if(url.hostname!=='127.0.0.1'||url.port==='54321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port==='54322')throw Error('LAB_SCOPE_INVALID');
 const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const first=await admin.auth.admin.createUser({email:'asset-race-'+randomUUID()+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 const second=await admin.auth.admin.createUser({email:'asset-other-'+randomUUID()+'@example.invalid',password:randomUUID()+'Aa1!',email_confirm:true});
 if(first.error||second.error)throw Error('LAB_USER_CREATE');
 const uid=first.data.user.id,other=second.data.user.id,asset=randomUUID(),bucket='race-'+randomUUID();
 const db=new pg.Client({connectionString:status.DB_URL}),locker=new pg.Client({connectionString:status.DB_URL}),writer=new pg.Client({connectionString:status.DB_URL});
 await Promise.all([db.connect(),locker.connect(),writer.connect()]);
 try{
  await db.query("insert into private.profiles(id,account_status) values($1,'deletion_pending'),($2,'active') on conflict(id) do update set account_status=excluded.account_status",[uid,other]);
  await db.query('insert into storage.buckets(id,name) values($1,$1)',[bucket]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id,version) values($1,'asset.png',$2,'fixture-version')",[bucket,uid]);
  const insert="insert into private.assets(id,path,mime_type,sha256,owner_id,version,validation_status,storage_bucket_id,storage_object_name) values($1,'fixture','image/png',repeat('a',64),$2,'1','provisional',$3,'asset.png')";
  await db.query(insert,[asset,uid,bucket]);
  await locker.query('begin');await locker.query('set local role riuya_storage_inventory');
  await locker.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid})]);
  const allowed=await locker.query("select private.storage_purge_path_owned($1,'asset.png',$2) ok",[bucket,uid]);assert.equal(allowed.rows[0].ok,true);
  const blocker=(await locker.query('select pg_backend_pid() pid')).rows[0].pid;
  const pending=writer.query(insert,[randomUUID(),other,bucket]).then(()=>({allowed:true}),error=>({error}));
  let blocked=false;
  for(let i=0;i<80;i++){
   blocked=(await db.query('select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) yes',[blocker])).rows[0].yes;
   if(blocked)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!blocked){await locker.query('rollback');await pending;throw Error('LAB_MAPPING_LOCK_NOT_OBSERVED');}
  await locker.query('commit');
  const outcome=await pending;assert.match(outcome.error?.message||'',/ASSET_STORAGE_PURGE_IN_PROGRESS/);
  assert.equal((await db.query('select count(*)::int n from private.assets where storage_bucket_id=$1',[bucket])).rows[0].n,1);
  const updateAsset=randomUUID();
  await db.query(insert.replace("'asset.png'","'other.png'"),[updateAsset,other,bucket]);
  await assert.rejects(()=>db.query("update private.assets set storage_object_name='asset.png' where id=$1",[updateAsset]),/ASSET_STORAGE_PURGE_IN_PROGRESS/);
  await db.query('delete from private.assets where id=$1',[updateAsset]);
  await db.query("insert into storage.objects(bucket_id,name,owner,owner_id,version) values($1,'legacy.png',$2,$3,'fixture-legacy')",[bucket,uid,other]);
  await assert.rejects(()=>db.query(insert.replace("'asset.png'","'legacy.png'"),[randomUUID(),other,bucket]),/ASSET_STORAGE_PURGE_IN_PROGRESS/);
  await db.query("update private.profiles set account_status='active' where id=$1",[uid]);
  await db.query(insert,[randomUUID(),other,bucket]);
  await db.query("update private.profiles set account_status='deletion_pending' where id=$1",[uid]);
  await locker.query('begin');await locker.query('set local role riuya_storage_inventory');
  await locker.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid})]);
  assert.equal((await locker.query("select private.storage_purge_path_owned($1,'asset.png',$2) ok",[bucket,uid])).rows[0].ok,false);
  await locker.query('rollback');
  console.log('Z11 activos: bloqueo de mapeo concurrente entre propietarios: OK');
 }finally{
  await locker.query('rollback').catch(()=>{});
  await Promise.all([db.end(),locker.end(),writer.end()]);
 }
}
