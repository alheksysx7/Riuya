-- Helpers limitados a la identidad del JWT. Postgres es propietario de estas
-- dos funciones porque el esquema auth no concede USAGE a roles de aplicación.
drop policy deletion_own_auth_sessions on auth.sessions;
revoke select(id,user_id,not_after),delete on auth.sessions from riuya_deletion_user;
create function private.current_session_is_live() returns boolean language plpgsql stable security definer set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;uid uuid;sid uuid;
begin
 begin uid:=(claims->>'sub')::uuid;sid:=(claims->>'session_id')::uuid;exception when others then return false;end;
 if uid is null or sid is null then return false;end if;
 return exists(select 1 from auth.sessions where id=sid and user_id=uid and (not_after is null or not_after>now()));
end $$;
create function private.revoke_current_user_sessions() returns void language plpgsql volatile security definer set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;uid uuid;
begin
 begin uid:=(claims->>'sub')::uuid;exception when others then raise exception 'UNAUTHENTICATED' using errcode='42501';end;
 if uid is null or not private.current_session_is_live() then raise exception 'UNAUTHENTICATED' using errcode='42501';end if;
 delete from auth.sessions where user_id=uid;
end $$;
revoke all on function private.current_session_is_live(),private.revoke_current_user_sessions() from public,anon,authenticated;
grant execute on function private.current_session_is_live(),private.revoke_current_user_sessions() to riuya_deletion_user;
grant create on schema private,api to riuya_deletion_user;
set local role riuya_deletion_user;
create or replace function private.recent_password_session(p_uid uuid,p_since timestamptz default null) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;sid uuid;entry jsonb;ts timestamptz;
begin
 begin sid:=(claims->>'session_id')::uuid;exception when others then return false;end;
 if sid is null or not private.current_session_is_live() or jsonb_typeof(claims->'amr') is distinct from 'array' then return false;end if;
 for entry in select * from jsonb_array_elements(claims->'amr') loop
  if entry->>'method'='password' and entry->>'timestamp' ~ '^[0-9]{1,12}$' then
   ts:=to_timestamp((entry->>'timestamp')::double precision);
   if ts>=now()-interval '5 minutes' and ts<=now()+interval '5 seconds' and (p_since is null or ts>=date_trunc('second',p_since)) then return true;end if;
  end if;
 end loop;
 return false;
end $$;
create or replace function api.request_account_deletion() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;p private.profiles%rowtype;r private.account_deletion_requests%rowtype;t timestamptz:=now();
begin
 if uid is null or not private.recent_password_session(uid) then raise exception 'REAUTH_REQUIRED' using errcode='PT401';end if;
 select * into p from private.profiles where id=uid for update;
 if not found or p.account_status<>'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 insert into private.account_deletion_requests(user_id,requested_at,recover_until,status) values(uid,t,t+interval '7 days','pending') returning * into r;
 update private.profiles set account_status='deletion_pending' where id=uid;
 insert into private.jobs(job_type,payload,dedupe_key,available_at,created_by) values('account.purge',jsonb_build_object('requestId',r.id),'purge:'||r.id,r.recover_until,uid);
 perform private.revoke_current_user_sessions();
 return jsonb_build_object('status','deletion_pending','requestedAt',r.requested_at,'recoverUntil',r.recover_until);
end $$;
reset role;
revoke create on schema private,api from riuya_deletion_user;
