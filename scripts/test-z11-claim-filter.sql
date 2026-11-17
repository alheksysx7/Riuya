begin;
set local role riuya_job_executor;
grant execute on function private.claim_job_filtered(text,integer,boolean) to postgres;
reset role;
do $$
declare regular uuid:=gen_random_uuid();purge uuid:=gen_random_uuid();expired uuid:=gen_random_uuid();r jsonb;
begin
 -- Solo se reclaman los dos trabajos ficticios, anteriores a cualquier otro.
 if exists(select 1 from private.jobs where status in ('queued','running') and available_at<=timestamptz '0001-01-01 00:00:02+00')
  or exists(select 1 from private.jobs where status='running' and lease_until<now() and attempts>=max_attempts)
 then raise exception 'TEST_QUEUE_NOT_ISOLATED';end if;
 insert into private.jobs(id,job_type,payload,dedupe_key,available_at) values
 (regular,'source.fetch','{}','z11-filter-'||regular,'0001-01-01 00:00:01+00'),
 (purge,'account.purge','{}','z11-filter-'||purge,'0001-01-01 00:00:00+00');
 insert into private.jobs(id,job_type,payload,dedupe_key,status,attempts,max_attempts,available_at,locked_by,lease_token,lease_until)
 values(expired,'account.purge','{}','z11-filter-'||expired,'running',4,4,'0001-01-01 00:00:00+00','fixture',gen_random_uuid(),now()-interval '1 minute');
 r:=private.claim_job_filtered('z11-test',60,false);
 if (r->>'id')::uuid<>regular then raise exception 'FILTER_REGULAR_FAILED';end if;
 if (select status from private.jobs where id=purge)<>'queued' or (select status from private.jobs where id=expired)<>'running' then raise exception 'FILTER_PURGE_TOUCHED';end if;
 r:=private.claim_job_filtered('z11-test',60,true);
 if (r->>'id')::uuid<>purge or (select status from private.jobs where id=expired)<>'failed' then raise exception 'FILTER_PURGE_FAILED';end if;
end $$;
rollback;
