begin;
set local role riuya_job_executor;
do $$
declare jid uuid:=gen_random_uuid();j jsonb;k jsonb;tok uuid;fresh uuid;
begin
 if has_table_privilege('authenticated','private.jobs','select') or has_function_privilege('authenticated','private.claim_job(text,integer)','execute') then raise exception 'UNAUTHORIZED_JOB_ACCESS';end if;
 insert into private.jobs(id,job_type,payload,dedupe_key,max_attempts) values(jid,'draft.generate','{}','fixture-'||jid,3);
 begin insert into private.jobs(job_type,payload,dedupe_key) values('draft.generate','{}','fixture-'||jid);raise exception 'DEDUPLICATION_FAILED';exception when unique_violation then null;end;
 j:=private.claim_job('worker-test-a',60);if j->>'id'<>jid::text then raise exception 'CLAIM_FAILED';end if;tok:=(j->>'leaseToken')::uuid;
 if private.finish_job(jid,gen_random_uuid(),true) then raise exception 'WRONG_TOKEN_ACCEPTED';end if;
 if not private.renew_job(jid,tok,60) then raise exception 'RENEW_FAILED';end if;
 update private.jobs set lease_until=now()-interval '1 second' where id=jid;
 if private.finish_job(jid,tok,true) then raise exception 'EXPIRED_TOKEN_ACCEPTED';end if;
 k:=private.claim_job('worker-test-b',60);fresh:=(k->>'leaseToken')::uuid;
 if k->>'id'<>jid::text or fresh=tok or (k->>'attempt')::int<>2 then raise exception 'RECLAIM_FAILED';end if;
 if not private.finish_job(jid,fresh,false,false,'TEST_ERROR') then raise exception 'RETRY_FAILED';end if;
 if not exists(select 1 from private.jobs where id=jid and status='queued' and available_at>now() and last_error='TEST_ERROR') then raise exception 'BACKOFF_MISSING';end if;
 update private.jobs set available_at=now() where id=jid;
 j:=private.claim_job('worker-test-c',60);fresh:=(j->>'leaseToken')::uuid;
 if not private.finish_job(jid,fresh,false,false,'TEST_ERROR') then raise exception 'FAIL_FAILED';end if;
 if not exists(select 1 from private.jobs where id=jid and status='failed' and attempts=3) then raise exception 'MAX_ATTEMPTS_FAILED';end if;
end $$;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();j jsonb;k jsonb;
begin
 insert into private.jobs(id,job_type,payload,dedupe_key) values(a,'draft.generate','{}','single-'||a),(b,'draft.generate','{}','single-'||b);
 if (select max_attempts from private.jobs where id=a)<>4 then raise exception 'THREE_RETRIES_REQUIRED';end if;
 j:=private.claim_job('worker-a',60);k:=private.claim_job('worker-b',60);
 if j is null or k is not null then raise exception 'CONCURRENT_GENERATION';end if;
 if not private.finish_job((j->>'id')::uuid,(j->>'leaseToken')::uuid,true) then raise exception 'FINISH_FIRST';end if;
 k:=private.claim_job('worker-b',60);if k is null or k->>'id'=j->>'id' then raise exception 'NEXT_GENERATION_BLOCKED';end if;
end $$;
rollback;

