grant select,update on private.notification_deliveries to riuya_deletion_user;
create policy deletion_own_deliveries on private.notification_deliveries for all to riuya_deletion_user using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy deletion_own_other_jobs_select on private.jobs for select to riuya_deletion_user using(created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy deletion_own_other_jobs_update on private.jobs for update to riuya_deletion_user using(created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
grant create on schema api to riuya_deletion_user;
set local role riuya_deletion_user;
create or replace function api.request_account_deletion() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;p private.profiles%rowtype;r private.account_deletion_requests%rowtype;t timestamptz:=now();
begin
 if uid is null or not private.recent_password_session(uid) then raise exception 'REAUTH_REQUIRED' using errcode='PT401';end if;
 select * into p from private.profiles where id=uid for update;
 if not found or p.account_status<>'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 insert into private.account_deletion_requests(user_id,requested_at,recover_until,status) values(uid,t,t+interval '7 days','pending') returning * into r;
 update private.profiles set account_status='deletion_pending' where id=uid;
 update private.notification_deliveries set status='cancelled' where user_id=uid and status='queued';
 update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where created_by=uid and job_type<>'account.purge' and status in ('queued','running');
 insert into private.jobs(job_type,payload,dedupe_key,available_at,created_by) values('account.purge',jsonb_build_object('requestId',r.id),'purge:'||r.id,r.recover_until,uid);
 perform private.revoke_current_user_sessions();
 return jsonb_build_object('status','deletion_pending','requestedAt',r.requested_at,'recoverUntil',r.recover_until);
end $$;
reset role;
revoke create on schema api from riuya_deletion_user;
