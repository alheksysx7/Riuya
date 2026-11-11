begin;
do $$
declare u uuid:=gen_random_uuid();other uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();s3 uuid:=gen_random_uuid();s4 uuid:=gen_random_uuid();r jsonb;request_id uuid;claims jsonb;ownjob uuid:=gen_random_uuid();otherjob uuid:=gen_random_uuid();delivery uuid:=gen_random_uuid();
begin
 if has_function_privilege('authenticated','api.request_account_deletion()','execute') or has_function_privilege('authenticated','api.recover_account_deletion()','execute') then raise exception 'EARLY_EXPOSURE';end if;
 insert into auth.users(id,email) values(u,'z11-'||u||'@example.invalid'),(other,'z11-'||other||'@example.invalid');
 insert into private.profiles(id) values(u),(other);
 insert into auth.sessions(id,user_id,created_at) values(s1,u,now()),(s2,other,now());
 insert into private.notification_deliveries(id,user_id,channel,local_date,timezone,scheduled_at) values(delivery,u,'news',current_date,'UTC',now());
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values(ownjob,'draft.generate','{}','z11-test-'||ownjob,u),(otherjob,'draft.generate','{}','z11-test-'||otherjob,other);

 claims:=jsonb_build_object('sub',u,'session_id',s1,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint-3600)));
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',claims::text,true);perform set_config('role','riuya_deletion_user',true);
 begin perform api.request_account_deletion();raise exception 'STALE_AUTH_ACCEPTED';exception when sqlstate 'PT401' then null;end;
 claims:=jsonb_set(claims,'{amr,0,timestamp}',to_jsonb(extract(epoch from now())::bigint));perform set_config('request.jwt.claims',claims::text,true);
 r:=api.request_account_deletion();if r->>'status'<>'deletion_pending' or (r->>'recoverUntil')::timestamptz-(r->>'requestedAt')::timestamptz<>interval '7 days' then raise exception 'BAD_REQUEST';end if;
 begin perform api.recover_account_deletion();raise exception 'REVOKED_SESSION_ACCEPTED';exception when sqlstate 'PT401' then null;end;
 perform set_config('role','none',true);
 if (select account_status from private.profiles where id=u)<>'deletion_pending' or exists(select 1 from auth.sessions where id=s1) or not exists(select 1 from auth.sessions where id=s2) then raise exception 'SESSION_REVOCATION_FAILED';end if;
 perform set_config('role','authenticated',true);
 begin perform api.my_trends();raise exception 'OLD_JWT_TRENDS_ACCESS';exception when insufficient_privilege then null;end;
 begin perform api.notification_settings();raise exception 'OLD_JWT_SETTINGS_ACCESS';exception when insufficient_privilege then null;end;
 begin perform api.account_ensure_profile();raise exception 'OLD_JWT_PROFILE_ACCESS';exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 if (select status from private.jobs where id=ownjob)<>'cancelled' or (select status from private.jobs where id=otherjob)<>'queued' or (select status from private.notification_deliveries where id=delivery)<>'cancelled' then raise exception 'OWN_TASK_CANCELLATION_FAILED';end if;
 select id into request_id from private.account_deletion_requests where user_id=u;
 if not exists(select 1 from private.jobs where job_type='account.purge' and payload->>'requestId'=request_id::text and status='queued') then raise exception 'PURGE_NOT_QUEUED';end if;
 insert into auth.sessions(id,user_id,created_at) values(s3,u,now());
 claims:=jsonb_set(claims,'{session_id}',to_jsonb(s3::text));perform set_config('request.jwt.claims',claims::text,true);perform set_config('role','riuya_deletion_user',true);
 r:=api.recover_account_deletion();if r->>'status'<>'active' then raise exception 'RECOVERY_FAILED';end if;
 perform set_config('role','none',true);
 if (select account_status from private.profiles where id=u)<>'active' or exists(select 1 from private.account_deletion_requests where user_id=u) or not exists(select 1 from private.jobs where payload->>'requestId'=request_id::text and status='cancelled') then raise exception 'RECOVERY_STATE_BAD';end if;
 claims:=jsonb_set(claims,'{session_id}',to_jsonb(s3::text));perform set_config('request.jwt.claims',claims::text,true);perform set_config('role','riuya_deletion_user',true);perform api.request_account_deletion();perform set_config('role','none',true);
 update private.account_deletion_requests set requested_at=now()-interval '8 days',recover_until=now()-interval '1 day' where user_id=u;
 insert into auth.sessions(id,user_id,created_at) values(s4,u,now());claims:=jsonb_set(claims,'{session_id}',to_jsonb(s4::text));perform set_config('request.jwt.claims',claims::text,true);perform set_config('role','riuya_deletion_user',true);
 begin perform api.recover_account_deletion();raise exception 'EXPIRED_RECOVERY_ACCEPTED';exception when sqlstate 'PT409' then null;end;
 perform set_config('role','none',true);
end $$;
rollback;
