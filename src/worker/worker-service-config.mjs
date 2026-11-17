// El servicio es opt-in y nunca puede procesar purgas en esta versión.
export function workerServiceConfig(env){
 if(env.RIUYA_WORKER_ENABLED!=='1'||(env.RIUYA_PURGE_ENABLED&&env.RIUYA_PURGE_ENABLED!=='0')||
  (env.NOTIFICATION_TRANSPORT&&env.NOTIFICATION_TRANSPORT!=='local'))throw Error('WORKER_CONFIG_INVALID');
 const text=env.RIUYA_WORKER_DATABASE_URL;
 if(typeof text!=='string'||text.length>2048)throw Error('WORKER_CONFIG_INVALID');
 let url;try{url=new URL(text);}catch{throw Error('WORKER_CONFIG_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.hostname||
  !url.pathname||url.pathname==='/'||url.hash||[...url.searchParams.keys()].some(key=>key!=='sslmode')||
  url.searchParams.getAll('sslmode').length>1)throw Error('WORKER_CONFIG_INVALID');
 const lab=env.RIUYA_WORKER_LAB_PLAINTEXT==='1'&&/^supabase_db_riuya_z11_lab_[a-f0-9]{20}$/.test(url.hostname);
 if(lab){if(url.searchParams.has('sslmode')&&url.searchParams.get('sslmode')!=='disable')throw Error('WORKER_CONFIG_INVALID');}
 else if(url.searchParams.get('sslmode')!=='verify-full'||env.RIUYA_WORKER_LAB_PLAINTEXT)throw Error('WORKER_CONFIG_INVALID');
 return {connectionString:text,connectionTimeoutMillis:5000};
}

const workerFunctions=[
 'private.renew_job(uuid,uuid,integer)',
 'private.finish_job(uuid,uuid,boolean,boolean,text)',
 'private.complete_fixture_draft(uuid,uuid,jsonb)',
 'private.source_job_info(uuid,uuid)',
 'private.complete_source_job(uuid,uuid,jsonb,text,text)',
 'private.cluster_job_info(uuid,uuid)',
 'private.complete_cluster_job(uuid,uuid,jsonb)',
 'private.ollama_job_info(uuid,uuid)',
 'private.complete_ollama_draft(uuid,uuid,jsonb,text,text,integer)',
 'private.schedule_notifications()',
 'private.complete_local_notification(uuid,uuid)',
 'private.claim_job_filtered(text,integer,boolean)'
];

export async function verifyWorkerServiceRole(client){
 const {rows}=await client.query(`select
  pg_has_role(current_user,'riuya_worker_client','usage') allowed,
  pg_has_role(current_user,'riuya_purge_worker_client','member') purge,
  has_function_privilege(current_user,'private.claim_job_filtered(text,integer,boolean)','execute') filtered_claim,
  exists(select 1 from pg_catalog.pg_roles r where pg_has_role(current_user,r.oid,'member')
   and has_function_privilege(r.oid,'private.claim_job(text,integer)','execute')) unfiltered_claim,
  exists(select 1 from pg_catalog.pg_roles r where
   (r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication)
   and pg_has_role(current_user,r.oid,'member')) elevated,
  exists(select 1 from pg_catalog.pg_roles r
   join pg_catalog.pg_class c on true
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where pg_has_role(current_user,r.oid,'member')
   and n.nspname in ('private','auth','storage','public') and c.relkind in ('r','p','v','m','f')
   and (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) direct_data,
  exists(select 1 from unnest($1::text[]) name
   where pg_catalog.to_regprocedure(name) is null
    or not has_function_privilege(current_user,pg_catalog.to_regprocedure(name),'execute')) missing_function,
  exists(select 1 from pg_catalog.pg_roles r
   join pg_catalog.pg_proc p on true
   join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   where pg_has_role(current_user,r.oid,'member')
    and n.nspname in ('private','auth','storage','public','api') and p.prosecdef
    and has_function_privilege(r.oid,p.oid,'execute')
    and not exists(select 1 from unnest($1::text[]) name where pg_catalog.to_regprocedure(name)=p.oid)) extra_definer`,[workerFunctions]);
 if(rows.length!==1||rows[0].allowed!==true||rows[0].purge!==false||rows[0].elevated!==false||rows[0].direct_data!==false||rows[0].filtered_claim!==true||rows[0].unfiltered_claim!==false||rows[0].missing_function!==false||rows[0].extra_definer!==false)throw Error('WORKER_ROLE_INVALID');
}
