begin;
set local role riuya_purge_executor;
grant execute on function private.begin_account_purge(uuid,uuid) to postgres;
reset role;
do $$
declare u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); jid uuid:=gen_random_uuid(); tok uuid:=gen_random_uuid(); result jsonb;
begin
 if has_function_privilege('authenticated','private.begin_account_purge(uuid,uuid)','execute') or has_function_privilege('riuya_worker_client','private.begin_account_purge(uuid,uuid)','execute') then raise exception 'PREMATURE_EXPOSURE'; end if;
 insert into auth.users(id,email) values(u,'z11-start-'||u||'@example.invalid'),(v,'z11-start-'||v||'@example.invalid');
 insert into private.profiles(id,account_status) values(u,'deletion_pending'),(v,'active');
 insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values(rid,u,now()-interval '6 days',now()+interval '1 day','pending');
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until)
 values(jid,'account.purge',jsonb_build_object('requestId',rid),'z11-start:'||jid,u,'running','test',tok,clock_timestamp()+interval '1 hour');
 begin
  perform private.begin_account_purge(jid,tok); raise exception 'EARLY_PURGE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'PURGE_UNAVAILABLE' then raise; end if; end;
 update private.account_deletion_requests set requested_at=now()-interval '8 days',recover_until=now()-interval '1 day' where id=rid;
 begin
  perform private.begin_account_purge(jid,gen_random_uuid()); raise exception 'WRONG_LEASE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'PURGE_LEASE_INVALID' then raise; end if; end;
 result:=private.begin_account_purge(jid,tok);
 if result->>'stage'<>'started' or (result->>'userId')::uuid<>u then raise exception 'WRONG_RESULT'; end if;
 result:=private.begin_account_purge(jid,tok);
 if result->>'stage'<>'started' then raise exception 'RETRY_FAILED'; end if;
 if (select status from private.account_deletion_requests where id=rid)<>'purging' or (select account_status from private.profiles where id=v)<>'active' then raise exception 'WRONG_STATE'; end if;
 update private.jobs set lease_until=clock_timestamp()-interval '1 second' where id=jid;
 begin
  perform private.begin_account_purge(jid,tok); raise exception 'EXPIRED_LEASE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'PURGE_LEASE_INVALID' then raise; end if; end;
end $$;
rollback;
