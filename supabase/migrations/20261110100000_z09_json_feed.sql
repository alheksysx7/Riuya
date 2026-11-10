grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create or replace function api.editor_save_source(p_id uuid,p_expected_version integer,p_name text,p_base_url text,p_domain text,p_type text,p_policy text,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;s private.sources%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'VERIFICATION_REQUIRED' using errcode='22023';end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 120 or length(coalesce(p_base_url,'')) not between 1 and 2048 or p_base_url !~ '^https?://' or length(coalesce(p_domain,'')) not between 1 and 253 or lower(p_domain) !~ '^[a-z0-9.-]+$' or p_type not in ('rss','atom','api') or length(btrim(coalesce(p_policy,''))) not between 1 and 1000 then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
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
