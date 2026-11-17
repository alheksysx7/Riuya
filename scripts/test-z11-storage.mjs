import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {removePurgeObjects} from '../src/worker/purge-storage.mjs';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322')||!status.SERVICE_ROLE_KEY)throw Error('Solo entorno local');
const client=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const db=new pg.Client({connectionString:status.DB_URL});const bucket='z11-test-'+randomUUID();let created=false,connected=false;
try{
 await db.connect();connected=true;
 let r=await client.storage.createBucket(bucket,{public:false});if(r.error)throw Error('TEST_BUCKET_CREATE '+r.error.status+' '+r.error.message);created=true;
 for(const name of ['owned/a.txt','owned/b.txt','other/keep.txt']){
  r=await client.storage.from(bucket).upload(name,new Blob(['fixture']),{contentType:'text/plain'});
  if(r.error)throw Error('TEST_UPLOAD');
 }
 const rows=(await db.query("select name,version from storage.objects where bucket_id=$1 and name in ('owned/a.txt','owned/b.txt') order by name",[bucket])).rows;
 assert.equal(rows.length,2);
 const entries=rows.map(x=>({bucket_id:bucket,name:x.name,version:x.version,is_versioned:false,archived_at:null,is_delete_marker:false}));
 await assert.rejects(()=>removePurgeObjects(client.storage,[...entries,{...entries[0],version:null}]),/PURGE_STORAGE_UNSUPPORTED/);
 assert.equal((await client.storage.from(bucket).download('owned/a.txt')).error,null);
 await removePurgeObjects(client.storage,entries);
 assert.ok((await client.storage.from(bucket).download('owned/a.txt')).error);
 assert.ok((await client.storage.from(bucket).download('owned/b.txt')).error);
 assert.equal((await client.storage.from(bucket).download('other/keep.txt')).error,null);
 await removePurgeObjects(client.storage,entries);
 await assert.rejects(()=>removePurgeObjects({from(){return{remove:async()=>({error:{}})}}},entries),/PURGE_STORAGE_DELETE_FAILED/);
 console.log('Z11 Storage: API local, aislamiento, reintento y rechazo de versiones incompletas: OK');
}finally{
 if(created){
  const empty=await client.storage.emptyBucket(bucket);if(empty.error)throw Error('TEST_BUCKET_EMPTY_FAILED');
  const removed=await client.storage.deleteBucket(bucket);if(removed.error)throw Error('TEST_BUCKET_DELETE_FAILED');
 }
 if(connected)await db.end();
}
