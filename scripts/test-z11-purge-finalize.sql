begin;
set local role riuya_purge_executor;
grant execute on function private.purge_account_contributions(uuid,uuid),private.purge_editorial_references(uuid,uuid),private.prepare_account_auth_purge(uuid,uuid),private.finish_account_purge(uuid,uuid),private.begin_account_purge(uuid,uuid) to postgres;
reset role;
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();tok uuid:=gen_random_uuid();oldjob uuid:=gen_random_uuid();otherjob uuid:=gen_random_uuid();bucket text:='z11-final-'||gen_random_uuid();r jsonb;
begin
 if has_function_privilege('authenticated','private.prepare_account_auth_purge(uuid,uuid)','execute') or has_function_privilege('riuya_worker_local','private.finish_account_purge(uuid,uuid)','execute') then raise exception 'EARLY_EXPOSURE';end if;
 insert into auth.users(id,email) values(u,'z11-final-'||u||'@example.invalid'),(v,'z11-final-'||v||'@example.invalid');
 insert into private.profiles(id,account_status,alias,timezone) values(u,'deletion_pending','Identidad ficticia','America/Guayaquil'),(v,'active','Otra persona','UTC');
 insert into private.user_roles(user_id,role) values(u,'editor'),(v,'user');
 insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values(rid,u,now()-interval '8 days',now()-interval '1 day','pending');
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values(jid,'account.purge',jsonb_build_object('requestId',rid),'z11-final-'||jid,u,'running','fixture',tok,now()+interval '1 hour');
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values(oldjob,'draft.generate','{}','z11-final-'||oldjob,u),(otherjob,'draft.generate','{}','z11-final-'||otherjob,v);
 insert into private.generation_runs(job_id,provider,model,prompt_version,canon_version,candidate) values(oldjob,'fixture','fixture','1','1','{}');
 perform private.purge_account_contributions(jid,tok);perform private.purge_editorial_references(jid,tok);
 begin
  insert into storage.buckets(id,name) values(bucket,bucket);
  insert into storage.objects(bucket_id,name,owner_id,version) values(bucket,'ficticio',u::text,'fixture-version');
  begin perform private.prepare_account_auth_purge(jid,tok);raise exception 'PREPARED_WITH_OBJECT';exception when raise_exception then if sqlerrm<>'PURGE_STORAGE_NOT_EMPTY' then raise;end if;end;
  raise exception 'ROLLBACK_OBJECT_FIXTURE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_OBJECT_FIXTURE' then raise;end if;end;
 begin perform private.prepare_account_auth_purge(jid,gen_random_uuid());raise exception 'WRONG_LEASE_ACCEPTED';exception when raise_exception then if sqlerrm<>'PURGE_LEASE_INVALID' then raise;end if;end;
 r:=private.prepare_account_auth_purge(jid,tok);
 if r->>'stage'<>'prepared' or (r->>'userId')::uuid<>u then raise exception 'NOT_PREPARED';end if;
 if exists(select 1 from private.jobs where id=oldjob) or exists(select 1 from private.generation_runs where job_id=oldjob) or exists(select 1 from private.user_roles where user_id=u) then raise exception 'OWN_DATA_REMAINS';end if;
 if not exists(select 1 from private.jobs where id=otherjob) or not exists(select 1 from private.user_roles where user_id=v) then raise exception 'OTHER_DATA_LOST';end if;
 if not exists(select 1 from private.profiles where id=u and alias is null and timezone='UTC' and account_status='deletion_pending') then raise exception 'PROFILE_NOT_MINIMIZED';end if;
 r:=private.prepare_account_auth_purge(jid,tok);if r->>'stage'<>'prepared' then raise exception 'RETRY_PREPARE_FAILED';end if;
 begin perform private.finish_account_purge(jid,tok);raise exception 'FINISHED_WITH_AUTH';exception when raise_exception then if sqlerrm<>'PURGE_AUTH_STILL_EXISTS' then raise;end if;end;
 delete from auth.users where id=u;
 r:=private.begin_account_purge(jid,tok);if r->>'stage'<>'prepared' or (r->>'userId')::uuid<>u then raise exception 'CRASH_RESUME_FAILED';end if;
 if not private.finish_account_purge(jid,tok) then raise exception 'FINISH_FAILED';end if;
 if exists(select 1 from private.profiles where id=u) or not exists(select 1 from private.account_purge_operations where job_id=jid and stage='finalized' and user_id is null) or not exists(select 1 from private.jobs where id=jid and status='succeeded' and created_by is null and lease_token is null) then raise exception 'FINAL_STATE';end if;
 if not exists(select 1 from auth.users where id=v) then raise exception 'OTHER_ACCOUNT_LOST';end if;
end $$;
rollback;
