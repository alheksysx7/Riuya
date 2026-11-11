import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import pg from 'pg';import {processLocalNotification} from '../src/worker/notification.mjs';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const pw=readFileSync('.env.worker.local','utf8').match(/^RIUYA_WORKER_PASSWORD=([a-f0-9]{64})$/m)?.[1];if(!pw)throw Error('Worker no configurado');
const u=randomUUID(),a=randomUUID(),r=randomUUID(),d=randomUUID(),j=randomUUID(),token=randomUUID();const admin=new pg.Client({connectionString:status.DB_URL}),worker=new pg.Client({host:'127.0.0.1',port:54322,user:'riuya_worker_local',password:pw,database:'postgres'});let setup=false;
try{
 await Promise.all([admin.connect(),worker.connect()]);await admin.query('begin');
 await admin.query('insert into auth.users(id,email) values($1,$2)',[u,'z10-'+u+'@example.invalid']);await admin.query('insert into private.profiles(id) values($1)',[u]);
 await admin.query("insert into private.notification_preferences(user_id,news_opt_in,hour_local,timezone,news_enabled_at,news_seen_at,schedule_changed_at) values($1,true,8,'UTC',now()-interval '2 hours',now()-interval '2 hours',now()-interval '2 hours')",[u]);
 await admin.query('insert into private.articles(id,category_id) select $1,id from private.categories limit 1',[a]);await admin.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values($1,$2,1,'SIMULACIÓN Z10','Prueba','[]')",[r,a]);await admin.query("update private.articles set status='published',current_revision_id=$2,published_at=now()-interval '1 hour' where id=$1",[a,r]);
 await admin.query("insert into private.notification_deliveries(id,user_id,channel,local_date,timezone,scheduled_at) values($1,$2,'news',(now() at time zone 'UTC')::date,'UTC',now())",[d,u]);
 await admin.query("insert into private.jobs(id,job_type,payload,dedupe_key,status,locked_by,lease_token,lease_until,created_by) values($1,'notification.send',jsonb_build_object('deliveryId',$2::uuid),'z10-test-'||($1::uuid)::text,'running','test',$3,now()+interval '1 minute',$4)",[j,d,token,u]);
 await admin.query('commit');setup=true;
 await processLocalNotification(worker,{id:j,leaseToken:token});
 const row=await admin.query("select d.status,d.sent_at is not null sent,j.status job from private.notification_deliveries d join private.jobs j on j.id=$2 where d.id=$1",[d,j]);assert.deepEqual(row.rows[0],{status:'sent',sent:true,job:'succeeded'});
 await assert.rejects(()=>processLocalNotification(worker,{id:j,leaseToken:token}),/NOTIFICATION_LEASE_EXPIRED/);
 await admin.query('begin');await admin.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);const history=await admin.query('select api.notification_history() value');await admin.query('rollback');
 assert.equal(history.rows[0].value.length,1);assert(!JSON.stringify(history.rows[0].value).match(/participants|percentage|opinions|email/));
 console.log('Z10 entrega local: capturada una vez y sin datos sensibles en historial: OK');
}finally{
 await admin.query('rollback').catch(()=>{});
 if(setup){await admin.query("delete from private.jobs where id=$1 and dedupe_key=$2",[j,'z10-test-'+j]);await admin.query('delete from private.notification_deliveries where id=$1 and user_id=$2',[d,u]);await admin.query("update private.articles set status='draft',current_revision_id=null where id=$1",[a]);await admin.query('delete from private.article_revisions where article_id=$1',[a]);await admin.query('delete from private.articles where id=$1',[a]);await admin.query('delete from auth.users where id=$1',[u]);}
 await Promise.all([admin.end().catch(()=>{}),worker.end().catch(()=>{})]);
}
