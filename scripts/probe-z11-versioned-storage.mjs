import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),db=new pg.Client({connectionString:status.DB_URL}),bucket='z11-versions-'+randomUUID();let created=false,connected=false;
try{
 await db.connect();connected=true;
 let r=await admin.storage.createBucket(bucket,{public:false,versioningStatus:'ENABLED'});
 if(r.error)throw Error('TEST_VERSION_BUCKET '+r.error.message);created=true;
 r=await admin.storage.from(bucket).upload('fixture.txt',new Blob(['uno']),{contentType:'text/plain'});if(r.error)throw Error('TEST_UPLOAD');
 r=await admin.storage.from(bucket).update('fixture.txt',new Blob(['dos']),{contentType:'text/plain'});if(r.error)throw Error('TEST_UPDATE');
 r=await admin.storage.from(bucket).remove(['fixture.txt']);if(r.error)throw Error('TEST_DELETE_MARKER');
 const rows=(await db.query('select version is not null has_version,is_versioned,archived_at is not null archived,is_delete_marker,owner_id is null no_owner from storage.objects where bucket_id=$1 order by created_at',[bucket])).rows;
 console.log(JSON.stringify({count:rows.length,rows}));
}finally{
 if(created){
  for(let i=0;i<10;i++){
   const rows=(await db.query('select name,version from storage.objects where bucket_id=$1',[bucket])).rows;
   if(!rows.length)break;
   if(rows.some(x=>!x.version))throw Error('TEST_VERSION_CLEANUP_UNSUPPORTED');
   const r=await admin.storage.from(bucket).remove(rows.map(x=>({path:x.name,versionId:x.version})));if(r.error)throw Error('TEST_VERSION_CLEANUP');
  }
  const left=(await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bucket])).rows[0].n;
  if(left)throw Error('TEST_VERSION_CLEANUP');
  const r=await admin.storage.deleteBucket(bucket);if(r.error)throw Error('TEST_BUCKET_CLEANUP');
 }
 if(connected)await db.end();
}
