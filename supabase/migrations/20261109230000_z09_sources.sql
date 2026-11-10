-- Fuentes verificadas editorialmente y metadatos mínimos; sin artículos completos.
alter table private.sources
 add column verified_by uuid references private.profiles(id) on delete restrict,
 add column version integer not null default 1 check(version>0),
 add column etag text check(etag is null or length(etag)<=512),
 add column last_modified text check(last_modified is null or length(last_modified)<=512),
 add column last_requested_at timestamptz;
create table private.source_items(
 id uuid primary key default gen_random_uuid(),source_id uuid not null references private.sources(id),
 canonical_url text not null unique check(length(canonical_url)<=2048 and canonical_url ~ '^https?://'),
 title text not null check(length(btrim(title)) between 1 and 300),
 external_date timestamptz not null,ingested_at timestamptz not null default now(),
 provider_key text check(provider_key is null or length(provider_key)<=500)
);
alter table private.sources enable row level security;
alter table private.source_items enable row level security;
revoke all on private.sources,private.source_items from public,anon,authenticated;
grant select,insert,update on private.sources to riuya_editor_executor,riuya_job_executor;
grant select on private.source_items to riuya_editor_executor;
grant select,insert on private.source_items to riuya_job_executor;
create policy editor_sources on private.sources for all to riuya_editor_executor using(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active')) with check(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));
create policy editor_source_items on private.source_items for select to riuya_editor_executor using(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));
create policy worker_sources on private.sources for all to riuya_job_executor using(true) with check(true);
create policy worker_source_items on private.source_items for all to riuya_job_executor using(true) with check(true);

grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create function api.editor_save_source(p_id uuid,p_expected_version integer,p_name text,p_base_url text,p_domain text,p_type text,p_policy text,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;s private.sources%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'VERIFICATION_REQUIRED' using errcode='22023';end if;
 if p_id is null then insert into private.sources(name,base_url,domain,source_type,usage_policy,verified_by,verified) values(p_name,p_base_url,lower(p_domain),p_type,p_policy,uid,true) returning * into s;
 else
  select * into s from private.sources where id=p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if s.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
  update private.sources set name=p_name,base_url=p_base_url,domain=lower(p_domain),source_type=p_type,usage_policy=p_policy,verified_by=uid,verified=true,version=version+1,etag=null,last_modified=null where id=p_id returning * into s;
 end if;
 return jsonb_build_object('id',s.id,'version',s.version);
end $$;
create function api.editor_sources() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;v jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select jsonb_build_object('sources',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,name,base_url,domain,source_type,usage_policy,version,is_active,verified,last_requested_at,last_fetched_at,created_at from private.sources order by created_at desc limit 50) x),'[]'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.ingested_at desc) from (select id,source_id,canonical_url,title,external_date,ingested_at from private.source_items order by ingested_at desc limit 50) x),'[]'::jsonb)) into v;
 return v;
end $$;
create function api.editor_fetch_source(p_id uuid,p_expected_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;s private.sources%rowtype;j uuid;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into s from private.sources where id=p_id for update;
 if not found or not s.is_active or not s.verified or s.verified_by is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if s.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if s.last_requested_at is not null and s.last_requested_at>now()-interval '30 minutes' then raise exception 'SOURCE_RATE_LIMITED' using errcode='PT429';end if;
 insert into private.jobs(job_type,payload,dedupe_key,created_by) values('source.fetch',jsonb_build_object('sourceId',s.id,'sourceVersion',s.version),'source:'||s.id||':'||gen_random_uuid(),uid) returning id into j;
 update private.sources set last_requested_at=now() where id=s.id;
 return jsonb_build_object('id',j,'status','queued');
end $$;
revoke all on function api.editor_save_source(uuid,integer,text,text,text,text,text,boolean),api.editor_sources(),api.editor_fetch_source(uuid,integer) from public,anon;
grant execute on function api.editor_save_source(uuid,integer,text,text,text,text,text,boolean),api.editor_sources(),api.editor_fetch_source(uuid,integer) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;

grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create function private.source_job_info(p_job uuid,p_token uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j private.jobs%rowtype;s private.sources%rowtype;
begin
 select * into j from private.jobs where id=p_job and status='running' and job_type='source.fetch' and lease_token=p_token and lease_until>now();
 if not found then return null;end if;
 select * into s from private.sources where id=(j.payload->>'sourceId')::uuid and version=(j.payload->>'sourceVersion')::integer and is_active and verified and verified_by is not null;
 if not found then return null;end if;
 return jsonb_build_object('id',s.id,'version',s.version,'feedUrl',s.base_url,'domain',s.domain,'type',s.source_type,'etag',s.etag,'lastModified',s.last_modified);
end $$;
create function private.complete_source_job(p_job uuid,p_token uuid,p_items jsonb,p_etag text,p_modified text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;s private.sources%rowtype;x jsonb;
begin
 select * into j from private.jobs where id=p_job and status='running' and job_type='source.fetch' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 select * into s from private.sources where id=(j.payload->>'sourceId')::uuid and version=(j.payload->>'sourceVersion')::integer and is_active and verified and verified_by is not null for update;
 if not found then return false;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>50 or length(p_items::text)>150000 or length(coalesce(p_etag,''))>512 or length(coalesce(p_modified,''))>512 then raise exception 'INVALID_ITEMS' using errcode='22023';end if;
 for x in select * from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['url','title','date']) or (select count(*) from jsonb_object_keys(x))<>3 then raise exception 'INVALID_ITEMS' using errcode='22023';end if;
  insert into private.source_items(source_id,canonical_url,title,external_date) values(s.id,x->>'url',x->>'title',(x->>'date')::timestamptz) on conflict(canonical_url) do nothing;
 end loop;
 update private.sources set etag=p_etag,last_modified=p_modified,last_fetched_at=now() where id=s.id;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function private.source_job_info(uuid,uuid),private.complete_source_job(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.source_job_info(uuid,uuid),private.complete_source_job(uuid,uuid,jsonb,text,text) to riuya_worker_client;
reset role;
revoke create on schema private from riuya_job_executor;
