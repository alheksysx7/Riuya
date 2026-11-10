grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
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
  update private.sources set name=p_name,base_url=p_base_url,domain=lower(p_domain),source_type=p_type,usage_policy=p_policy,verified_by=uid,verified=true,version=version+1,etag=null,last_modified=null where id=p_id returning * into s;
 end if;
 return jsonb_build_object('id',s.id,'version',s.version);
end $$;
reset role;
revoke create on schema api from riuya_editor_executor;
grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create or replace function private.complete_source_job(p_job uuid,p_token uuid,p_items jsonb,p_etag text,p_modified text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;s private.sources%rowtype;x jsonb;
begin
 select * into j from private.jobs where id=p_job and status='running' and job_type='source.fetch' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 select * into s from private.sources where id=(j.payload->>'sourceId')::uuid and version=(j.payload->>'sourceVersion')::integer and is_active and verified and verified_by is not null for update;
 if not found then return false;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>50 or length(p_items::text)>150000 or length(coalesce(p_etag,''))>512 or length(coalesce(p_modified,''))>512 then raise exception 'INVALID_ITEMS' using errcode='22023';end if;
 for x in select * from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['url','title','date']) or (select count(*) from jsonb_object_keys(x))<>3 then raise exception 'INVALID_ITEMS' using errcode='22023';end if;
  if lower(substring(coalesce(x->>'url','') from '^https?://([^/?#]+)')) is distinct from lower(s.domain) then raise exception 'INVALID_ITEM_DOMAIN' using errcode='22023';end if;
  insert into private.source_items(source_id,canonical_url,title,external_date) values(s.id,x->>'url',x->>'title',(x->>'date')::timestamptz) on conflict(canonical_url) do nothing;
 end loop;
 update private.sources set etag=p_etag,last_modified=p_modified,last_fetched_at=now() where id=s.id;
 if jsonb_array_length(p_items)>0 then
  insert into private.jobs(job_type,payload,dedupe_key,created_by) values('event.cluster',jsonb_build_object('sourceJobId',j.id),'cluster:'||j.id,j.created_by) on conflict(dedupe_key) do nothing;
 end if;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
reset role;
revoke create on schema private from riuya_job_executor;
