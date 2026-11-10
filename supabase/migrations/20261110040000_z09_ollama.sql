-- Generación local con evidencia de modelo; nunca publica.
alter table private.generation_runs drop constraint generation_runs_provider_check;
alter table private.generation_runs add constraint generation_runs_provider_check check(provider in ('fixture','ollama'));
alter table private.generation_runs add column model_digest text check(model_digest is null or model_digest ~ '^[a-fA-F0-9]{64}$');
alter table private.generation_runs add column config jsonb not null default '{}'::jsonb check(jsonb_typeof(config)='object');

grant update on private.jobs to riuya_editor_executor;
create policy editor_jobs_update on private.jobs for update to riuya_editor_executor using(created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create function api.enqueue_ollama_draft(p_item_id uuid,p_request_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;j private.jobs%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_item_id is null or p_request_id is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if not exists(select 1 from private.source_items i join private.sources s on s.id=i.source_id where i.id=p_item_id and s.is_active and s.verified and s.verified_by is not null) then raise exception 'SOURCE_NOT_VERIFIED' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,921));
 select * into j from private.jobs where dedupe_key='ollama:'||uid||':'||p_request_id;
 if found then if j.payload->>'itemId'<>p_item_id::text then raise exception 'REQUEST_CONFLICT' using errcode='PT409';end if;return jsonb_build_object('id',j.id,'status',j.status);end if;
 if (select count(*) from private.jobs where created_by=uid and job_type='draft.generate' and created_at>now()-interval '1 hour')>=5 then raise exception 'RATE_LIMITED' using errcode='PT429';end if;
 insert into private.jobs(job_type,payload,dedupe_key,created_by) values('draft.generate',jsonb_build_object('mode','ollama','itemId',p_item_id),'ollama:'||uid||':'||p_request_id,uid) returning * into j;
 return jsonb_build_object('id',j.id,'status',j.status);
end $$;
create function api.cancel_editor_job(p_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;j private.jobs%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into j from private.jobs where id=p_id and created_by=uid and job_type='draft.generate' for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if j.status not in ('queued','running') then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 return jsonb_build_object('id',j.id,'status','cancelled');
end $$;
revoke all on function api.enqueue_ollama_draft(uuid,uuid),api.cancel_editor_job(uuid) from public,anon;
grant execute on function api.enqueue_ollama_draft(uuid,uuid),api.cancel_editor_job(uuid) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;

grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create function private.ollama_job_info(p_job uuid,p_token uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j private.jobs%rowtype;v jsonb;
begin
 select * into j from private.jobs where id=p_job and status='running' and job_type='draft.generate' and payload->>'mode'='ollama' and lease_token=p_token and lease_until>now();
 if not found then return null;end if;
 select jsonb_build_object('title',i.title,'source',jsonb_build_object('key','f1','name',s.name,'date',to_char(i.external_date at time zone 'UTC','YYYY-MM-DD'),'url',i.canonical_url)) into v from private.source_items i join private.sources s on s.id=i.source_id where i.id=(j.payload->>'itemId')::uuid and s.is_active and s.verified and s.verified_by is not null;
 return v;
end $$;
create function private.complete_ollama_draft(p_id uuid,p_token uuid,p_candidate jsonb,p_model text,p_digest text,p_attempts integer) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;info jsonb;paragraph text;
begin
 select * into j from private.jobs where id=p_id and status='running' and job_type='draft.generate' and payload->>'mode'='ollama' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 info:=private.ollama_job_info(p_id,p_token);if info is null then return false;end if;
 if coalesce(p_model,'') !~ '^[A-Za-z0-9._:/-]{1,128}$' or coalesce(p_digest,'') !~ '^[a-fA-F0-9]{64}$' or p_attempts is null or p_attempts not between 1 and 3 or jsonb_typeof(p_candidate) is distinct from 'object' or length(p_candidate::text)>65536 or length(coalesce(p_candidate->>'title','')) not between 1 and 300 or length(btrim(coalesce(p_candidate->>'summary','')))=0 or jsonb_typeof(p_candidate->'opinions') is distinct from 'array' or jsonb_array_length(p_candidate->'opinions')<>8 or jsonb_typeof(p_candidate->'paragraphs') is distinct from 'array' or jsonb_array_length(p_candidate->'paragraphs')<1 or p_candidate->'sources' is distinct from jsonb_build_array(info->'source') then raise exception 'INVALID_CANDIDATE' using errcode='22023';end if;
 if (select count(distinct x->>'characterKey') from jsonb_array_elements(p_candidate->'opinions') x where x->>'characterKey' in ('rami','beatriz','leo','dmitri','naoki','salma','tove','kavya') and length(btrim(coalesce(x->>'body','')))>0)<>8 then raise exception 'INVALID_CANDIDATE' using errcode='22023';end if;
 for paragraph in select value from jsonb_array_elements_text(p_candidate->'paragraphs') loop
  if position('[f1]' in paragraph)=0 or exists(select 1 from regexp_matches(paragraph,'\[([A-Za-z0-9_-]+)\]','g') m where m[1]<>'f1') then raise exception 'INVALID_CITATION' using errcode='22023';end if;
 end loop;
 insert into private.generation_runs(job_id,provider,model,model_digest,prompt_version,canon_version,config,candidate) values(j.id,'ollama',p_model,p_digest,'ollama-v1','V3.1',jsonb_build_object('temperature',0.2,'attempts',p_attempts),p_candidate) on conflict(job_id) do nothing;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function private.ollama_job_info(uuid,uuid),private.complete_ollama_draft(uuid,uuid,jsonb,text,text,integer) from public,anon,authenticated;
grant execute on function private.ollama_job_info(uuid,uuid),private.complete_ollama_draft(uuid,uuid,jsonb,text,text,integer) to riuya_worker_client;
reset role;
revoke create on schema private from riuya_job_executor;
