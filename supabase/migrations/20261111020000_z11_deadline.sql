grant create on schema private,api to riuya_deletion_user;
set local role riuya_deletion_user;
create or replace function private.recent_password_session(p_uid uuid,p_since timestamptz default null) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;sid uuid;entry jsonb;ts timestamptz;
begin
 begin sid:=(claims->>'session_id')::uuid;if (claims->>'sub')::uuid is distinct from p_uid then return false;end if;exception when others then return false;end;
 if sid is null or not private.current_session_is_live() or jsonb_typeof(claims->'amr') is distinct from 'array' then return false;end if;
 for entry in select * from jsonb_array_elements(claims->'amr') loop
  if entry->>'method'='password' and entry->>'timestamp' ~ '^[0-9]{1,12}$' then
   ts:=to_timestamp((entry->>'timestamp')::double precision);
   if ts>=clock_timestamp()-interval '5 minutes' and ts<=clock_timestamp()+interval '5 seconds' and (p_since is null or ts>=date_trunc('second',p_since)) then return true;end if;
  end if;
 end loop;
 return false;
end $$;
create or replace function api.request_account_deletion() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;p private.profiles%rowtype;r private.account_deletion_requests%rowtype;t timestamptz;
begin
 if uid is null or not private.recent_password_session(uid) then raise exception 'REAUTH_REQUIRED' using errcode='PT401';end if;
 select * into p from private.profiles where id=uid for update;
 if not found or p.account_status<>'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 if not private.recent_password_session(uid) then raise exception 'REAUTH_REQUIRED' using errcode='PT401';end if;
 t:=clock_timestamp();
 insert into private.account_deletion_requests(user_id,requested_at,recover_until,status) values(uid,t,t+interval '7 days','pending') returning * into r;
 update private.profiles set account_status='deletion_pending' where id=uid;
 update private.notification_deliveries set status='cancelled' where user_id=uid and status='queued';
 update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where created_by=uid and job_type<>'account.purge' and status in ('queued','running');
 insert into private.jobs(job_type,payload,dedupe_key,available_at,created_by) values('account.purge',jsonb_build_object('requestId',r.id),'purge:'||r.id,r.recover_until,uid);
 perform private.revoke_current_user_sessions();
 return jsonb_build_object('status','deletion_pending','requestedAt',r.requested_at,'recoverUntil',r.recover_until);
end $$;
create or replace function api.recover_account_deletion() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;p private.profiles%rowtype;r private.account_deletion_requests%rowtype;
begin
 if uid is null or not private.recent_password_session(uid) then raise exception 'REAUTH_REQUIRED' using errcode='PT401';end if;
 select * into p from private.profiles where id=uid for update;
 if not found or p.account_status<>'deletion_pending' then raise exception 'RECOVERY_UNAVAILABLE' using errcode='PT404';end if;
 select * into r from private.account_deletion_requests where user_id=uid for update;
 if not found or r.status<>'pending' or clock_timestamp()>=r.recover_until or not private.recent_password_session(uid,r.requested_at) then raise exception 'RECOVERY_UNAVAILABLE' using errcode='PT409';end if;
 update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where job_type='account.purge' and payload->>'requestId'=r.id::text and status in ('queued','running');
 delete from private.account_deletion_requests where id=r.id;
 update private.profiles set account_status='active' where id=uid;
 return jsonb_build_object('status','active');
end $$;
reset role;
revoke create on schema private,api from riuya_deletion_user;
