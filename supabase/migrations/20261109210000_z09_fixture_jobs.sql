-- Worker client can invoke only the queue operations, never read tables directly.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_worker_client') then create role riuya_worker_client nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;end if;end $$;
grant usage on schema private to riuya_worker_client;
set local role riuya_job_executor;
grant execute on function private.claim_job(text,integer),private.renew_job(uuid,uuid,integer),private.finish_job(uuid,uuid,boolean,boolean,text) to riuya_worker_client;
reset role;

create table private.generation_runs(
 id uuid primary key default gen_random_uuid(),job_id uuid not null unique references private.jobs(id),
 provider text not null check(provider='fixture'),model text not null, prompt_version text not null,canon_version text not null,
 candidate jsonb not null check(jsonb_typeof(candidate)='object' and length(candidate::text)<=65536),
 created_at timestamptz not null default now()
);
alter table private.generation_runs enable row level security;
revoke all on private.generation_runs from public,anon,authenticated;
grant select,insert on private.generation_runs to riuya_job_executor;
create policy worker_generation on private.generation_runs for all to riuya_job_executor using(true) with check(true);
grant select on private.generation_runs to riuya_editor_executor;
create policy editor_generation on private.generation_runs for select to riuya_editor_executor using(true);
grant select,insert on private.jobs to riuya_editor_executor;
create policy editor_jobs_select on private.jobs for select to riuya_editor_executor using(created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy editor_jobs_insert on private.jobs for insert to riuya_editor_executor with check(created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);

grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create function private.complete_fixture_draft(p_id uuid,p_token uuid,p_candidate jsonb) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;
begin
 select * into j from private.jobs where id=p_id and status='running' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 if j.job_type<>'draft.generate' or j.payload<>'{"fixtureId":"demo-v1"}'::jsonb then raise exception 'INVALID_JOB';end if;
 if jsonb_typeof(p_candidate) is distinct from 'object' or length(p_candidate::text)>65536 or coalesce(p_candidate->>'title','') not like 'SIMULACIÓN%' or jsonb_typeof(p_candidate->'opinions') is distinct from 'array' or jsonb_array_length(p_candidate->'opinions')<>8 then raise exception 'INVALID_CANDIDATE';end if;
 insert into private.generation_runs(job_id,provider,model,prompt_version,canon_version,candidate) values(j.id,'fixture','fixture-v1','fixture-v1','V3.1',p_candidate) on conflict(job_id) do nothing;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function private.complete_fixture_draft(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.complete_fixture_draft(uuid,uuid,jsonb) to riuya_worker_client;
reset role;
revoke create on schema private from riuya_job_executor;

grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create function api.enqueue_fixture_draft(p_request_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;j private.jobs%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,921));
 select * into j from private.jobs where dedupe_key='fixture:'||uid||':'||p_request_id;
 if found then return jsonb_build_object('id',j.id,'status',j.status);end if;
 if (select count(*) from private.jobs where created_by=uid and job_type='draft.generate' and created_at>now()-interval '1 hour')>=5 then raise exception 'RATE_LIMITED' using errcode='PT429';end if;
 insert into private.jobs(job_type,payload,dedupe_key,created_by) values('draft.generate','{"fixtureId":"demo-v1"}', 'fixture:'||uid||':'||p_request_id,uid) on conflict(dedupe_key) do nothing;
 select * into j from private.jobs where dedupe_key='fixture:'||uid||':'||p_request_id;
 return jsonb_build_object('id',j.id,'status',j.status);
end $$;
create function api.editor_fixture_jobs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;answer jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts,'createdAt',j.created_at,'candidate',g.candidate) order by j.created_at desc),'[]'::jsonb) into answer from (select * from private.jobs where created_by=uid and job_type='draft.generate' order by created_at desc limit 20) j left join private.generation_runs g on g.job_id=j.id;
 return answer;
end $$;
revoke all on function api.enqueue_fixture_draft(uuid),api.editor_fixture_jobs() from public,anon;
grant execute on function api.enqueue_fixture_draft(uuid),api.editor_fixture_jobs() to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;
