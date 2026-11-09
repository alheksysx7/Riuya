import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const url=process.env.TEST_LOCAL_URL, anon=process.env.TEST_LOCAL_ANON, key=process.env.TEST_LOCAL_SERVICE;
if(url!=='http://127.0.0.1:54321'||!anon||!key) throw Error('Se requiere el entorno local explícito');
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const make=()=>createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const password=randomBytes(24).toString('hex'); const suffix=randomBytes(8).toString('hex'); const users=[]; let article;
const sql=(q)=>execFileSync('docker',['exec','-i','supabase_db_app','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:q,stdio:['pipe','ignore','pipe']});
function ok(v,m){if(!v)throw Error(m)}
async function user(role){const email=`z02-${role}-${suffix}@example.invalid`; const r=await admin.auth.admin.createUser({email,password,email_confirm:true}); if(r.error)throw r.error; const id=r.data.user.id; users.push(id); ok(/^[0-9a-f-]{36}$/.test(id),'UUID inválido'); sql(`insert into private.profiles(id) values ('${id}'); insert into private.user_roles(user_id,role) values ('${id}','${role}');`); const c=make(); const a=await c.auth.signInWithPassword({email,password}); if(a.error)throw a.error; return c;}
try {
 const e=await user('editor'), u=await user('user'), guest=make();
 let r=await u.schema('api').rpc('editor_list'); ok(r.error,'lector pudo listar editor');
 r=await guest.schema('api').rpc('editor_list'); ok(r.error,'anónimo pudo listar editor');
 r=await e.schema('api').rpc('editor_catalog'); if(r.error)throw r.error; const cat=r.data;
 const data={categoryId:cat.categories[0].id,title:'Noticia ficticia de prueba',summary:'palabra '.repeat(40).trim(),paragraphs:['texto '.repeat(150).trim()+' [f1]'],sources:[{key:'f1',name:'Fuente ficticia',date:'2026-11-08',url:'https://example.invalid'}],opinions:cat.characters.map(x=>({characterKey:x.key,body:'opinión '.repeat(40).trim()}))};
 r=await e.schema('api').rpc('editor_save',{p_id:null,p_expected_version:null,p_data:{...data,opinions:data.opinions.slice(0,7)}}); if(r.error)throw r.error; article=r.data.id; let ver=r.data.version,rev=r.data.revisionId;
 r=await e.schema('api').rpc('editor_review',{p_id:article,p_expected_version:ver}); if(r.error)throw r.error; ver=r.data.version; let hash=r.data.reviewHash;
 r=await e.schema('api').rpc('editor_publish',{p_id:article,p_expected_version:ver,p_revision_id:rev,p_review_hash:hash,p_confirm:true}); ok(r.error?.message==='EIGHT_OPINIONS_REQUIRED','siete opiniones no rechazadas');
 r=await e.schema('api').rpc('editor_save',{p_id:article,p_expected_version:ver,p_data:data}); if(r.error)throw r.error; ver=r.data.version; rev=r.data.revisionId;
 r=await e.schema('api').rpc('editor_review',{p_id:article,p_expected_version:ver}); if(r.error)throw r.error; ver=r.data.version; hash=r.data.reviewHash;
 r=await e.schema('api').rpc('editor_publish',{p_id:article,p_expected_version:ver,p_revision_id:rev,p_review_hash:'incorrecta',p_confirm:true}); ok(r.error?.message==='VERSION_CONFLICT','huella incorrecta no rechazada'); ok(r.status===409,'el conflicto no devuelve HTTP 409');
 r=await e.schema('api').rpc('editor_publish',{p_id:article,p_expected_version:ver,p_revision_id:rev,p_review_hash:hash,p_confirm:false}); ok(r.error?.message==='APPROVAL_REQUIRED','aprobación falsa no rechazada'); ok(r.status===400,'aprobación inválida no devuelve HTTP 400');
 r=await e.schema('api').rpc('editor_publish',{p_id:article,p_expected_version:ver,p_revision_id:rev,p_review_hash:hash,p_confirm:true}); if(r.error)throw r.error; ver=r.data.version;
 r=await guest.schema('api').rpc('public_article',{p_id:article}); ok(r.data?.title===data.title,'anónimo no ve publicación');
 r=await e.schema('api').rpc('editor_withdraw',{p_id:article,p_expected_version:ver,p_reason:'Fin de prueba ficticia'}); if(r.error)throw r.error;
 r=await guest.schema('api').rpc('public_article',{p_id:article}); ok(!r.data,'anónimo ve noticia retirada');
 console.log('HTTP real: roles, 7 opiniones, huella, aprobación, publicación y retirada: OK');
} finally {
 if(article && /^[0-9a-f-]{36}$/.test(article)) sql(`begin; delete from private.editorial_events where article_id='${article}'; delete from private.opinions where revision_id in (select id from private.article_revisions where article_id='${article}'); delete from private.article_sources where revision_id in (select id from private.article_revisions where article_id='${article}'); update private.articles set status='draft',current_revision_id=null where id='${article}'; delete from private.article_revisions where article_id='${article}'; delete from private.articles where id='${article}'; commit;`);
 for(const id of users){const x=await admin.auth.admin.deleteUser(id); if(x.error) console.error('No se pudo eliminar usuario ficticio',id);}
}


