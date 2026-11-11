-- Inicio serializado de purga. No se habilita al worker hasta completar el flujo.
create table private.account_purge_operations (
  request_id uuid primary key,
  job_id uuid not null unique references private.jobs(id),
  user_id uuid,
  stage text not null check (stage in ('started','contributions_removed','prepared','finalized')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((stage = 'finalized' and user_id is null) or (stage <> 'finalized' and user_id is not null))
);
alter table private.account_purge_operations enable row level security;
revoke all on private.account_purge_operations from public, anon, authenticated;

do $$ begin
 if not exists(select 1 from pg_roles where rolname='riuya_purge_executor') then
   create role riuya_purge_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 end if;
end $$;
grant riuya_purge_executor to postgres with inherit false;
grant usage on schema private to riuya_purge_executor;
grant select, update(account_status) on private.profiles to riuya_purge_executor;
grant select, update(status) on private.account_deletion_requests to riuya_purge_executor;
grant select, update(status) on private.jobs to riuya_purge_executor;
grant select, insert, update on private.account_purge_operations to riuya_purge_executor;
create policy purge_profile_read on private.profiles for select to riuya_purge_executor using (true);
create policy purge_profile_lock on private.profiles for update to riuya_purge_executor using (true) with check (true);
create policy purge_request_access on private.account_deletion_requests for all to riuya_purge_executor using (true) with check (true);
create policy purge_job_read on private.jobs for select to riuya_purge_executor using (true);
create policy purge_job_lock on private.jobs for update to riuya_purge_executor using (true) with check (true);
create policy purge_operation_access on private.account_purge_operations for all to riuya_purge_executor using (true) with check (true);

grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
create function private.begin_account_purge(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare req_id uuid; uid uuid; profile_status text; req private.account_deletion_requests%rowtype;
 job private.jobs%rowtype; op private.account_purge_operations%rowtype;
begin
 -- Lecturas preliminares no confirman identidad ni autorización.
 select nullif(payload->>'requestId','')::uuid,created_by into req_id,uid
 from private.jobs where id=p_job and job_type='account.purge';
 if not found or req_id is null then raise exception 'PURGE_UNAVAILABLE'; end if;
 select * into op from private.account_purge_operations where job_id=p_job;
 if found and op.stage='prepared' then
   select * into job from private.jobs where id=p_job for update;
   if job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until is null or job.lease_until<=clock_timestamp() or p_token is null then raise exception 'PURGE_LEASE_INVALID'; end if;
   return jsonb_build_object('stage',op.stage,'userId',op.user_id);
 end if;
 if uid is null then raise exception 'PURGE_UNAVAILABLE'; end if;
 -- Igual que recuperación: perfil, solicitud y trabajo, en ese orden.
 select account_status into profile_status from private.profiles where id=uid for update;
 if not found or profile_status<>'deletion_pending' then raise exception 'PURGE_UNAVAILABLE'; end if;
 select * into req from private.account_deletion_requests where id=req_id and user_id=uid for update;
 if not found or req.status not in ('pending','purging') or clock_timestamp()<req.recover_until then raise exception 'PURGE_UNAVAILABLE'; end if;
 select * into job from private.jobs where id=p_job for update;
 if not found or job.job_type<>'account.purge' or job.created_by is distinct from uid
   or job.payload->>'requestId' is distinct from req_id::text
   or job.status<>'running' or p_token is null or job.lease_token is distinct from p_token
   or job.lease_until is null or job.lease_until<=clock_timestamp() then raise exception 'PURGE_LEASE_INVALID'; end if;
 insert into private.account_purge_operations(request_id,job_id,user_id,stage)
 values(req_id,p_job,uid,'started')
 on conflict(request_id) do nothing;
 select * into op from private.account_purge_operations where request_id=req_id for update;
 if op.job_id is distinct from p_job or op.user_id is distinct from uid or op.stage not in ('started','contributions_removed') then raise exception 'PURGE_STATE_INVALID'; end if;
 update private.account_deletion_requests set status='purging' where id=req_id;
 return jsonb_build_object('stage',op.stage,'userId',uid);
end $$;
revoke all on function private.begin_account_purge(uuid,uuid) from public,anon,authenticated;
reset role;
revoke create on schema private from riuya_purge_executor;
