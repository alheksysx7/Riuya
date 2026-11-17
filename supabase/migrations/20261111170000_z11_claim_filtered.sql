-- El worker omite bajas mientras no estén habilitadas explícitamente.
grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create function private.claim_job_filtered(p_worker text,p_lease_seconds integer,p_allow_purge boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;tok uuid:=gen_random_uuid();allow_purge boolean:=coalesce(p_allow_purge,false);
begin
 if length(btrim(coalesce(p_worker,''))) not between 1 and 100 or p_lease_seconds not between 10 and 600 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if allow_purge and not pg_catalog.pg_has_role(session_user,'riuya_purge_worker_client','member') then raise exception 'PURGE_WORKER_NOT_AUTHORIZED' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(9210009);
 update private.jobs set status='failed',locked_by=null,lease_token=null,lease_until=null,last_error='LEASE_EXPIRED',updated_at=now()
 where status='running' and lease_until<now() and attempts>=max_attempts and (allow_purge or job_type<>'account.purge');
 select * into j from private.jobs where ((status='queued' and available_at<=now()) or (status='running' and lease_until<now())) and attempts<max_attempts
 and (allow_purge or job_type<>'account.purge')
 and (job_type<>'draft.generate' or not exists(select 1 from private.jobs active where active.job_type='draft.generate' and active.status='running' and active.lease_until>now()))
 order by available_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update private.jobs set status='running',attempts=attempts+1,locked_by=p_worker,lease_token=tok,lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'type',j.job_type,'payload',j.payload,'attempt',j.attempts,'leaseToken',j.lease_token,'leaseUntil',j.lease_until);
end $$;
revoke all on function private.claim_job_filtered(text,integer,boolean) from public,anon,authenticated;
grant execute on function private.claim_job_filtered(text,integer,boolean) to riuya_worker_client;
reset role;
revoke create on schema private from riuya_job_executor;
