-- Cola editorial: el worker solo puede ejecutar funciones específicas.
create table private.jobs(
 id uuid primary key default gen_random_uuid(),
 job_type text not null check(job_type in ('source.fetch','event.cluster','draft.generate')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and length(payload::text)<=16384),
 dedupe_key text not null unique check(length(dedupe_key) between 1 and 200),
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
 attempts integer not null default 0 check(attempts>=0),
 max_attempts integer not null default 3 check(max_attempts between 1 and 10),
 available_at timestamptz not null default now(),
 locked_by text, lease_token uuid, lease_until timestamptz,
 last_error text check(last_error is null or length(last_error)<=200),
 created_by uuid references private.profiles(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((status='running' and locked_by is not null and lease_token is not null and lease_until is not null) or (status<>'running' and locked_by is null and lease_token is null and lease_until is null))
);
create index jobs_runnable on private.jobs(available_at,id) where status in ('queued','running');
alter table private.jobs enable row level security;
revoke all on private.jobs from public,anon,authenticated;
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_job_executor') then create role riuya_job_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;end if;end $$;
grant riuya_job_executor to postgres with inherit false;
grant usage on schema private to riuya_job_executor;
grant select,insert,update on private.jobs to riuya_job_executor;
create policy job_executor_access on private.jobs for all to riuya_job_executor using(true) with check(true);
grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create function private.claim_job(p_worker text,p_lease_seconds integer default 60) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;tok uuid:=gen_random_uuid();
begin
 if length(btrim(coalesce(p_worker,''))) not between 1 and 100 or p_lease_seconds not between 10 and 600 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Expired leases can be retried; exhausted leases terminate rather than loop forever.
 update private.jobs set status='failed',locked_by=null,lease_token=null,lease_until=null,last_error='LEASE_EXPIRED',updated_at=now() where status='running' and lease_until<now() and attempts>=max_attempts;
 select * into j from private.jobs where ((status='queued' and available_at<=now()) or (status='running' and lease_until<now())) and attempts<max_attempts order by available_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update private.jobs set status='running',attempts=attempts+1,locked_by=p_worker,lease_token=tok,lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'type',j.job_type,'payload',j.payload,'attempt',j.attempts,'leaseToken',j.lease_token,'leaseUntil',j.lease_until);
end $$;
create function private.renew_job(p_id uuid,p_token uuid,p_seconds integer default 60) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if p_seconds not between 10 and 600 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 update private.jobs set lease_until=now()+make_interval(secs=>p_seconds),updated_at=now() where id=p_id and status='running' and lease_token=p_token and lease_until>now();
 return found;
end $$;
create function private.finish_job(p_id uuid,p_token uuid,p_success boolean,p_permanent boolean default false,p_error text default null) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;delay_seconds integer;
begin
 select * into j from private.jobs where id=p_id and status='running' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 delay_seconds:=case j.attempts when 1 then 30 when 2 then 120 else 600 end + floor(random()*6)::integer;
 update private.jobs set status=case when p_success then 'succeeded' when p_permanent or attempts>=max_attempts then 'failed' else 'queued' end,
  available_at=case when not p_success and not p_permanent and attempts<max_attempts then now()+make_interval(secs=>delay_seconds) else available_at end,
  last_error=case when p_success then null else left(coalesce(p_error,'WORKER_ERROR'),200) end,
  locked_by=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function private.claim_job(text,integer),private.renew_job(uuid,uuid,integer),private.finish_job(uuid,uuid,boolean,boolean,text) from public,anon,authenticated;
reset role;
revoke create on schema private from riuya_job_executor;
