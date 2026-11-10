alter table private.sources add column is_simulation boolean not null default false;
grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create or replace function private.cluster_job_info(p_job uuid,p_token uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.jobs where id=p_job and status='running' and job_type='event.cluster' and lease_token=p_token and lease_until>now()) then return null;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'date',x.external_date,'simulation',x.is_simulation) order by x.ingested_at desc) from (select i.id,i.title,i.external_date,i.ingested_at,s.is_simulation from private.source_items i join private.sources s on s.id=i.source_id order by i.ingested_at desc,i.id desc limit 100) x),'[]'::jsonb);
end $$;
create or replace function private.complete_cluster_job(p_job uuid,p_token uuid,p_pairs jsonb) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;x jsonb;a uuid;b uuid;
begin
 select * into j from private.jobs where id=p_job and status='running' and job_type='event.cluster' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 if jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_array_length(p_pairs)>200 or length(p_pairs::text)>30000 then raise exception 'INVALID_PAIRS' using errcode='22023';end if;
 for x in select * from jsonb_array_elements(p_pairs) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['a','b']) or (select count(*) from jsonb_object_keys(x))<>2 then raise exception 'INVALID_PAIRS' using errcode='22023';end if;
  a:=(x->>'a')::uuid;b:=(x->>'b')::uuid;if a=b then raise exception 'INVALID_PAIRS' using errcode='22023';end if;
  if not exists(select 1 from private.source_items ia join private.sources sa on sa.id=ia.source_id join private.source_items ib on ib.id=b join private.sources sb on sb.id=ib.source_id where ia.id=a and sa.is_simulation=sb.is_simulation) then raise exception 'SIMULATION_MISMATCH' using errcode='22023';end if;
  insert into private.source_group_proposals(item_a,item_b) values(least(a,b),greatest(a,b)) on conflict(item_a,item_b) do nothing;
 end loop;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
reset role;
revoke create on schema private from riuya_job_executor;
grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create or replace function api.editor_sources() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;v jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select jsonb_build_object('sources',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,name,base_url,domain,source_type,usage_policy,version,is_active,is_simulation,(verified and verified_by is not null) as verified,last_requested_at,last_fetched_at,created_at from private.sources order by created_at desc limit 50) x),'[]'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.ingested_at desc) from (select id,source_id,canonical_url,title,external_date,ingested_at from private.source_items order by ingested_at desc limit 50) x),'[]'::jsonb)) into v;
 return v;
end $$;
create or replace function api.editor_save_source(p_id uuid,p_expected_version integer,p_name text,p_base_url text,p_domain text,p_type text,p_policy text,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;s private.sources%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'VERIFICATION_REQUIRED' using errcode='22023';end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 120 or length(coalesce(p_base_url,'')) not between 1 and 2048 or p_base_url !~ '^https?://' or length(coalesce(p_domain,'')) not between 1 and 253 or lower(p_domain) !~ '^[a-z0-9.-]+$' or p_type not in ('rss','atom') or length(btrim(coalesce(p_policy,''))) not between 1 and 1000 then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
 if lower(substring(coalesce(p_base_url,'') from '^https?://([^/?#]+)')) is distinct from lower(p_domain) or p_domain !~ '^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$' or p_domain ~ '^([0-9]+\.)+[0-9]+$' or lower(p_domain) ~ '(\.local|\.localhost)$' then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
 if p_id is null then insert into private.sources(name,base_url,domain,source_type,usage_policy,verified_by,verified) values(p_name,p_base_url,lower(p_domain),p_type,p_policy,uid,true) returning * into s;
 else
  select * into s from private.sources where id=p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if s.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
  if s.is_simulation then raise exception 'SIMULATION_IMMUTABLE' using errcode='22023';end if;
  update private.sources set name=p_name,base_url=p_base_url,domain=lower(p_domain),source_type=p_type,usage_policy=p_policy,verified_by=uid,verified=true,version=version+1,etag=null,last_modified=null where id=p_id returning * into s;
 end if;
 return jsonb_build_object('id',s.id,'version',s.version);
end $$;
create or replace function api.editor_set_source_active(p_id uuid,p_expected_version integer,p_active boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;s private.sources%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_active is null then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
 select * into s from private.sources where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if s.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if s.is_simulation then raise exception 'SIMULATION_IMMUTABLE' using errcode='22023';end if;
 if p_active and (not s.verified or s.verified_by is null) then raise exception 'VERIFICATION_REQUIRED' using errcode='22023';end if;
 update private.sources set is_active=p_active,version=version+1 where id=s.id returning * into s;
 return jsonb_build_object('id',s.id,'version',s.version,'active',s.is_active);
end $$;
create or replace function api.editor_set_event_primary(p_event_id uuid,p_event_version integer,p_article_id uuid,p_article_version integer,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;e private.events%rowtype;a private.articles%rowtype;demo boolean;article_demo boolean;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'APPROVAL_REQUIRED' using errcode='22023';end if;
 select * into e from private.events where id=p_event_id for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into a from private.articles where id=p_article_id for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if e.version is distinct from p_event_version or a.version is distinct from p_article_version or a.status<>'published' or (e.primary_article_id is not null and e.primary_article_id<>a.id) or (a.event_id is not null and a.event_id<>e.id) then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 select s.is_simulation into demo from private.source_group_proposals g join private.source_items i on i.id=g.item_a join private.sources s on s.id=i.source_id where g.event_id=e.id and g.status='confirmed' limit 1;
 select r.title like 'SIMULACIÓN%' into article_demo from private.article_revisions r where r.id=a.current_revision_id;
 if demo is null or article_demo is null or demo<>article_demo then raise exception 'SIMULATION_MISMATCH' using errcode='22023';end if;
 if e.primary_article_id=a.id then return jsonb_build_object('eventId',e.id,'articleId',a.id);end if;
 update private.articles set event_id=e.id,version=version+1,updated_at=now() where id=a.id;
 update private.events set primary_article_id=a.id,version=version+1 where id=e.id;
 return jsonb_build_object('eventId',e.id,'articleId',a.id);
end $$;
reset role;
revoke create on schema api from riuya_editor_executor;
