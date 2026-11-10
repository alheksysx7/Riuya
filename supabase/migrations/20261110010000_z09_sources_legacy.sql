grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create or replace function api.editor_sources() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;v jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select jsonb_build_object('sources',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,name,base_url,domain,source_type,usage_policy,version,is_active,(verified and verified_by is not null) as verified,last_requested_at,last_fetched_at,created_at from private.sources order by created_at desc limit 50) x),'[]'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.ingested_at desc) from (select id,source_id,canonical_url,title,external_date,ingested_at from private.source_items order by ingested_at desc limit 50) x),'[]'::jsonb)) into v;
 return v;
end $$;
reset role;
revoke create on schema api from riuya_editor_executor;
