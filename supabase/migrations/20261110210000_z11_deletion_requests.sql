-- Solicitudes de baja; las funciones permanecen privadas hasta completar la purga.
alter table private.jobs drop constraint jobs_job_type_check;
alter table private.jobs add constraint jobs_job_type_check check(job_type in ('source.fetch','event.cluster','draft.generate','notification.send','account.purge'));
create table private.account_deletion_requests(
 id uuid primary key default gen_random_uuid(),user_id uuid not null unique references private.profiles(id) on delete cascade,
 requested_at timestamptz not null,recover_until timestamptz not null,status text not null check(status in ('pending','purging')),
 check(recover_until=requested_at+interval '7 days')
);
alter table private.account_deletion_requests enable row level security;
revoke all on private.account_deletion_requests from public,anon,authenticated;

do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_deletion_user') then create role riuya_deletion_user nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;end if;end $$;
grant riuya_deletion_user to postgres with inherit false;
grant usage on schema private,auth,api to riuya_deletion_user;
grant select,update(account_status) on private.profiles to riuya_deletion_user;
grant select,insert,delete on private.account_deletion_requests to riuya_deletion_user;
grant select,insert,update on private.jobs to riuya_deletion_user;
grant select(id,user_id,not_after),delete on auth.sessions to riuya_deletion_user;
create policy deletion_own_profile_select on private.profiles for select to riuya_deletion_user using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy deletion_own_profile_update on private.profiles for update to riuya_deletion_user using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy deletion_own_request on private.account_deletion_requests for all to riuya_deletion_user using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy deletion_own_job on private.jobs for all to riuya_deletion_user using(job_type='account.purge' and created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(job_type='account.purge' and created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy deletion_own_auth_sessions on auth.sessions for all to riuya_deletion_user using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);

grant create on schema private,api to riuya_deletion_user;
set local role riuya_deletion_user;
create function private.recent_password_session(p_uid uuid,p_since timestamptz default null) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;sid uuid;entry jsonb;ts timestamptz;
begin
 begin sid:=(claims->>'session_id')::uuid;exception when others then return false;end;
 if sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=p_uid and (not_after is null or not_after>now())) or jsonb_typeof(claims->'amr') is distinct from 'array' then return false;end if;
 for entry in select * from jsonb_array_elements(claims->'amr') loop
  if entry->>'method'='password' and entry->>'timestamp' ~ '^[0-9]{1,12}$' then
   ts:=to_timestamp((entry->>'timestamp')::double precision);
   if ts>=now()-interval '5 minutes' and ts<=now()+interval '5 seconds' and (p_since is null or ts>=date_trunc('second',p_since)) then return true;end if;
  end if;
 end loop;
 return false;
end $$;
create function api.request_account_deletion() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;p private.profiles%rowtype;r private.account_deletion_requests%rowtype;t timestamptz:=now();
begin
 if uid is null or not private.recent_password_session(uid) then raise exception 'REAUTH_REQUIRED' using errcode='PT401';end if;
 select * into p from private.profiles where id=uid for update;
 if not found or p.account_status<>'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 insert into private.account_deletion_requests(user_id,requested_at,recover_until,status) values(uid,t,t+interval '7 days','pending') returning * into r;
 update private.profiles set account_status='deletion_pending' where id=uid;
 insert into private.jobs(job_type,payload,dedupe_key,available_at,created_by) values('account.purge',jsonb_build_object('requestId',r.id),'purge:'||r.id,r.recover_until,uid);
 delete from auth.sessions where user_id=uid;
 return jsonb_build_object('status','deletion_pending','requestedAt',r.requested_at,'recoverUntil',r.recover_until);
end $$;
create function api.recover_account_deletion() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;p private.profiles%rowtype;r private.account_deletion_requests%rowtype;
begin
 if uid is null or not private.recent_password_session(uid) then raise exception 'REAUTH_REQUIRED' using errcode='PT401';end if;
 select * into p from private.profiles where id=uid for update;
 if not found or p.account_status<>'deletion_pending' then raise exception 'RECOVERY_UNAVAILABLE' using errcode='PT404';end if;
 select * into r from private.account_deletion_requests where user_id=uid for update;
 if not found or r.status<>'pending' or now()>=r.recover_until or not private.recent_password_session(uid,r.requested_at) then raise exception 'RECOVERY_UNAVAILABLE' using errcode='PT409';end if;
 update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where job_type='account.purge' and payload->>'requestId'=r.id::text and status in ('queued','running');
 delete from private.account_deletion_requests where id=r.id;
 update private.profiles set account_status='active' where id=uid;
 return jsonb_build_object('status','active');
end $$;
revoke all on function private.recent_password_session(uuid,timestamptz),api.request_account_deletion(),api.recover_account_deletion() from public,anon,authenticated;
reset role;
revoke create on schema private,api from riuya_deletion_user;
