grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create or replace function api.editor_fetch_source(p_id uuid,p_expected_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;s private.sources%rowtype;j uuid;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into s from private.sources where id=p_id for update;
 if not found or not s.is_active or not s.verified or s.verified_by is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if s.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if s.last_requested_at is not null and s.last_requested_at>now()-make_interval(mins=>greatest(30,s.fetch_interval_minutes)) then raise exception 'SOURCE_RATE_LIMITED' using errcode='PT429';end if;
 insert into private.jobs(job_type,payload,dedupe_key,created_by) values('source.fetch',jsonb_build_object('sourceId',s.id,'sourceVersion',s.version),'source:'||s.id||':'||gen_random_uuid(),uid) returning id into j;
 update private.sources set last_requested_at=now() where id=s.id;
 return jsonb_build_object('id',j,'status','queued');
end $$;
reset role;
revoke create on schema api from riuya_editor_executor;
