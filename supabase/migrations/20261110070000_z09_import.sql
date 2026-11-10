alter table private.generation_runs add column imported_article_id uuid references private.articles(id);
create unique index generation_import_once on private.generation_runs(imported_article_id) where imported_article_id is not null;
grant update on private.generation_runs to riuya_editor_executor;
create policy editor_generation_update on private.generation_runs for update to riuya_editor_executor using(exists(select 1 from private.jobs j where j.id=job_id and j.created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid)) with check(exists(select 1 from private.jobs j where j.id=job_id and j.created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid));
grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create or replace function api.editor_fixture_jobs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;answer jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts,'createdAt',j.created_at,'provider',coalesce(g.provider,case when j.payload->>'mode'='ollama' then 'ollama' else 'fixture' end),'error',j.last_error,'candidate',g.candidate,'importedArticleId',g.imported_article_id) order by j.created_at desc),'[]'::jsonb) into answer from (select * from private.jobs where created_by=uid and job_type='draft.generate' order by created_at desc limit 20) j left join private.generation_runs g on g.job_id=j.id;
 return answer;
end $$;
create function api.import_generated_draft(p_job_id uuid,p_category_id uuid,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;j private.jobs%rowtype;g private.generation_runs%rowtype;result jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'CONFIRMATION_REQUIRED' using errcode='22023';end if;
 select * into j from private.jobs where id=p_job_id and created_by=uid and job_type='draft.generate' and status='succeeded' for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into g from private.generation_runs where job_id=j.id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if g.imported_article_id is not null then return jsonb_build_object('id',g.imported_article_id,'replayed',true);end if;
 result:=api.editor_save(null,null,g.candidate||jsonb_build_object('categoryId',p_category_id));
 update private.generation_runs set imported_article_id=(result->>'id')::uuid where id=g.id;
 return jsonb_build_object('id',result->>'id','replayed',false);
end $$;
revoke all on function api.import_generated_draft(uuid,uuid,boolean) from public,anon;
grant execute on function api.import_generated_draft(uuid,uuid,boolean) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;
