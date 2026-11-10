grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create or replace function private.finish_job(p_id uuid,p_token uuid,p_success boolean,p_permanent boolean default false,p_error text default null) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;delay_seconds integer;
begin
 select * into j from private.jobs where id=p_id and status='running' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 delay_seconds:=case j.attempts when 1 then 30 when 2 then 120 else 600 end + floor(random()*6)::integer;
 update private.jobs set status=case when p_success then 'succeeded' when p_permanent or attempts>=max_attempts then 'failed' else 'queued' end,
  available_at=case when not p_success and not p_permanent and attempts<max_attempts then now()+make_interval(secs=>delay_seconds) else available_at end,
  last_error=case when p_success then null else case when p_error ~ '^[A-Z0-9_]{1,64}$' then p_error else 'WORKER_ERROR' end end,
  locked_by=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 return true;
end $$;
reset role;
revoke create on schema private from riuya_job_executor;
