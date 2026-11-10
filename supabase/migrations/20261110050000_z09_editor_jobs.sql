grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create or replace function api.editor_fixture_jobs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;answer jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts,'createdAt',j.created_at,'provider',coalesce(g.provider,case when j.payload->>'mode'='ollama' then 'ollama' else 'fixture' end),'error',j.last_error,'candidate',g.candidate) order by j.created_at desc),'[]'::jsonb) into answer from (select * from private.jobs where created_by=uid and job_type='draft.generate' order by created_at desc limit 20) j left join private.generation_runs g on g.job_id=j.id;
 return answer;
end $$;
create function api.editor_source_jobs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;v jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'status',x.status,'error',x.last_error,'sourceId',x.payload->>'sourceId') order by x.created_at desc),'[]'::jsonb) into v from (select * from private.jobs where created_by=uid and job_type='source.fetch' order by created_at desc limit 20) x;
 return v;
end $$;
revoke all on function api.editor_source_jobs() from public,anon;
grant execute on function api.editor_source_jobs() to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;
