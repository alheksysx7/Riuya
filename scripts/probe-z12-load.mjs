import assert from 'node:assert/strict';
import {createHmac,randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import pg from 'pg';

// Ensayo opcional y destructible: solo se ejecuta en el proyecto temporal.
export async function probeLoad({status,id,appPort}){
 const api=new URL(status.API_URL),database=new URL(status.DB_URL);
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||api.hostname!=='127.0.0.1'||api.port==='54321'||
  database.hostname!=='127.0.0.1'||database.port==='54322'||!status.JWT_SECRET||!status.ANON_KEY||
  (appPort!==undefined&&(!Number.isInteger(appPort)||appPort<1024||appPort>65535)))throw Error('LAB_SCOPE_INVALID');
 const db=new pg.Client({connectionString:status.DB_URL});await db.connect();
 try{
  await db.query("set statement_timeout='180s'");
  await db.query('begin');
  try{
   await db.query('create temp table load_articles as select n,gen_random_uuid() id,gen_random_uuid() revision from generate_series(1,10000) n');
   await db.query('create temp table load_users as select n,gen_random_uuid() id from generate_series(1,60) n');
   await db.query("insert into auth.users(id,email) select id,'load-'||id::text||'@example.invalid' from load_users");
   await db.query('insert into private.profiles(id) select id from load_users');
   await db.query('insert into private.articles(id,category_id) select l.id,c.id from load_articles l cross join lateral (select id from private.categories order by id limit 1) c');
   await db.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) select revision,id,1,'SIMULACIÓN carga '||n,'Resumen ficticio','[]'::jsonb from load_articles");
   await db.query("insert into private.opinions(revision_id,character_id,body) select l.revision,c.id,'Opinión ficticia' from load_articles l cross join private.characters c where c.is_active");
   await db.query("update private.articles a set status='published',published_at=now(),current_revision_id=l.revision from load_articles l where a.id=l.id");
   await db.query("insert into private.participations(user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) select u.id,a.id,a.revision,'none',gen_random_uuid(),repeat('a',64) from load_users u cross join load_articles a where u.n<=10");
   await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  const counts=(await db.query("select (select count(*)::int from load_articles) articles,(select count(*)::int from private.participations p join load_users u on u.id=p.user_id where u.n<=10) participations")).rows[0];
  assert.deepEqual(counts,{articles:10000,participations:100000});
  const article=(await db.query('select id,revision from load_articles where n=10000')).rows[0];
  const users=(await db.query('select id from load_users where n>10 order by n')).rows;
  assert.equal(users.length,50);
  const token=sub=>{
   const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
   const head=enc({alg:'HS256',typ:'JWT'}),payload=enc({role:'authenticated',sub,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300});
   return head+'.'+payload+'.'+createHmac('sha256',status.JWT_SECRET).update(head+'.'+payload).digest('base64url');
  };
  const call=async(path,body,credential)=>{
   const started=performance.now();
   const response=await fetch(status.API_URL+'/rest/v1/rpc/'+path,{method:'POST',signal:AbortSignal.timeout(30000),
    headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+credential,'Content-Type':'application/json','Content-Profile':'api'},body:JSON.stringify(body)});
   const value=await response.json();
   return {status:response.status,value,ms:performance.now()-started};
  };
  const percentile=values=>{const sorted=values.toSorted((a,b)=>a-b);return sorted[Math.ceil(sorted.length*.95)-1];};
  const feedBody={p_category:null,p_cursor:null};
  const warm=await call('reader_feed',feedBody,status.ANON_KEY);assert.equal(warm.status,200);
  const reads=await Promise.all(Array.from({length:50},()=>call('reader_feed',feedBody,status.ANON_KEY)));
  assert(reads.every(r=>r.status===200&&Array.isArray(r.value.items)));
  if(appPort!==undefined){
   const base='http://127.0.0.1:'+appPort;
   const webCall=async()=>{
    const started=performance.now();
    const response=await fetch(base+'/api/v1/news',{signal:AbortSignal.timeout(30000)});
    const value=await response.json();
    return {status:response.status,value,ms:performance.now()-started};
   };
   const webWarm=await webCall();assert.equal(webWarm.status,200);
   const webReads=await Promise.all(Array.from({length:50},()=>webCall()));
   assert(webReads.every(r=>r.status===200&&Array.isArray(r.value.items)&&r.value.items.length===10),'LAB_WEB_LOAD_FAILED');
   console.log('Z12 carga HTTP Next: 10000 noticias, 100000 participaciones, 50 lecturas públicas concurrentes; p95='+percentile(webReads.map(x=>x.ms)).toFixed(1)+' ms');
   const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const webArticle=(await db.query('select id,revision from load_articles where n=9999')).rows[0];
   const password=randomBytes(24).toString('base64url'),webUsers=[];
   for(let i=0;i<50;i++){
    const email='load-web-'+randomUUID()+'@example.invalid';
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error||!created.data.user)throw Error('LAB_WEB_USER_CREATE_FAILED');
    webUsers.push({email,id:created.data.user.id});
   }
   await db.query('insert into private.profiles(id) select unnest($1::uuid[]) on conflict(id) do nothing',[webUsers.map(u=>u.id)]);
   for(const user of webUsers){
    const jar=new Map();
    const client=createServerClient(status.API_URL,status.ANON_KEY,{cookieOptions:{name:'sb-host-auth-token'},
     cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>{for(const item of items)jar.set(item.name,item.value);}}});
    const signed=await client.auth.signInWithPassword({email:user.email,password});
    if(signed.error||!jar.size)throw Error('LAB_WEB_SIGNIN_FAILED');
    user.cookie=[...jar].map(([name,value])=>name+'='+encodeURIComponent(value)).join('; ');
    user.operation=randomUUID();
   }
   const post=async user=>{
    const started=performance.now();
    const response=await fetch(base+'/api/v1/news/'+webArticle.id+'/participation',{method:'POST',signal:AbortSignal.timeout(30000),
     headers:{Origin:base,'Content-Type':'application/json',Cookie:user.cookie},
     body:JSON.stringify({revisionId:webArticle.revision,operationId:user.operation,choiceKind:'none',opinionIds:[]})});
    return {status:response.status,value:await response.json(),ms:performance.now()-started};
   };
   const webStarted=performance.now();
   const submissions=await Promise.all(webUsers.flatMap(user=>[post(user),post(user)]));
   if(!submissions.every(r=>r.status===200&&r.value?.status==='confirmed')){
    const statuses={};for(const r of submissions)statuses[r.status]=(statuses[r.status]||0)+1;
    throw Error('LAB_WEB_CONFIRM_FAILED '+JSON.stringify(statuses));
   }
   for(let i=0;i<submissions.length;i+=2)assert.equal(submissions[i].value.id,submissions[i+1].value.id);
   const webCount=(await db.query('select count(*)::int n from private.participations where article_id=$1 and user_id=any($2::uuid[])',[webArticle.id,webUsers.map(u=>u.id)])).rows[0].n;
   assert.equal(webCount,50);
   console.log('Z12 carga confirmación HTTP Next: 50 sesiones autenticadas ficticias, 100 solicitudes; p95='+percentile(submissions.map(x=>x.ms)).toFixed(1)+' ms; total='+ (performance.now()-webStarted).toFixed(1)+' ms; duplicados=0');

  }
  const pairs=users.map(user=>({token:token(user.id),operation:randomUUID()}));
  const started=performance.now();
  const confirms=await Promise.all(pairs.flatMap(pair=>[0,1].map(()=>call('confirm_participation',
   {p_article_id:article.id,p_revision_id:article.revision,p_operation_id:pair.operation,p_choice_kind:'none',p_opinion_ids:[]},pair.token))));
  const elapsed=performance.now()-started;
  assert(confirms.every(r=>r.status===200&&r.value?.status==='confirmed'),'LAB_LOAD_CONFIRM_FAILED');
  for(let i=0;i<confirms.length;i+=2)assert.equal(confirms[i].value.id,confirms[i+1].value.id);
  const count=(await db.query('select count(*)::int n from private.participations p join load_users u on u.id=p.user_id where u.n>10 and p.article_id=$1',[article.id])).rows[0].n;
  assert.equal(count,50);
  console.log('Z12 carga RPC: 10000 noticias, 100000 participaciones y 50 sesiones ficticias; lectura p95='+percentile(reads.map(x=>x.ms)).toFixed(1)+' ms; confirmación p95='+percentile(confirms.map(x=>x.ms)).toFixed(1)+' ms; 100 solicitudes en '+elapsed.toFixed(1)+' ms; duplicados=0');
 }finally{await db.end();}
}
