grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
-- Mapear conflictos editoriales a HTTP 409 a través de PostgREST.
create or replace function api.editor_save(p_id uuid,p_expected_version integer,p_data jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype; rid uuid; cat uuid; op jsonb; src jsonb; cid uuid; rev integer;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'paragraphs') is distinct from 'array' or jsonb_typeof(p_data->'opinions') is distinct from 'array' or jsonb_typeof(p_data->'sources') is distinct from 'array' then raise exception 'INVALID_DATA' using errcode='22023'; end if;
 if length(p_data::text)>131072 or length(coalesce(p_data->>'title',''))>300 then raise exception 'INVALID_DATA' using errcode='22023'; end if;
 cat:=(p_data->>'categoryId')::uuid; if not exists(select 1 from private.categories c where c.id=cat and c.is_active) then raise exception 'INVALID_CATEGORY' using errcode='22023'; end if;
 if p_id is null then
  insert into private.articles(category_id,created_by) values(cat,uid) returning * into a; rev:=1;
 else
  select * into a from private.articles where id=p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if a.status not in ('draft','review') then raise exception 'NOT_EDITABLE' using errcode='23514'; end if;
  if p_expected_version is distinct from a.version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
  select coalesce(max(revision_number),0)+1 into rev from private.article_revisions where article_id=a.id;
 end if;
 insert into private.article_revisions(article_id,revision_number,title,micro_summary,full_paragraphs,created_by) values(a.id,rev,coalesce(p_data->>'title',''),coalesce(p_data->>'summary',''),p_data->'paragraphs',uid) returning id into rid;
 for src in select * from jsonb_array_elements(p_data->'sources') loop
  insert into private.article_sources(revision_id,citation_key,source_name,source_date,url) values(rid,src->>'key',src->>'name',(src->>'date')::date,src->>'url');
 end loop;
 for op in select * from jsonb_array_elements(p_data->'opinions') loop
  select id into cid from private.characters where stable_key=op->>'characterKey'; if cid is null then raise exception 'INVALID_CHARACTER' using errcode='22023'; end if;
  insert into private.opinions(revision_id,character_id,body) values(rid,cid,op->>'body');
 end loop;
 update private.articles set current_revision_id=rid,category_id=cat,status='draft',version=case when p_id is null then 1 else version+1 end,updated_at=now() where id=a.id returning * into a;
 return jsonb_build_object('id',a.id,'version',a.version,'revisionId',rid,'status',a.status);
end $$;

create or replace function api.editor_review(p_id uuid,p_expected_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into a from private.articles where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status not in ('draft','review') or a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 update private.articles set status='review',version=version+1,updated_at=now() where id=a.id returning * into a;
 return jsonb_build_object('id',a.id,'status',a.status,'version',a.version,'revisionId',a.current_revision_id,'reviewHash',private.editor_revision_hash(a.current_revision_id));
end $$;

create or replace function api.editor_publish(p_id uuid,p_expected_version integer,p_revision_id uuid,p_review_hash text,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype; r private.article_revisions%rowtype; w integer;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into a from private.articles where id=p_id for update; if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status <> 'review' or a.version is distinct from p_expected_version or a.current_revision_id is distinct from p_revision_id or p_review_hash is distinct from private.editor_revision_hash(a.current_revision_id) then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 if p_confirm is distinct from true then raise exception 'APPROVAL_REQUIRED' using errcode='22023'; end if;
 select * into r from private.article_revisions where id=a.current_revision_id;
 if length(btrim(r.title))=0 or not exists(select 1 from private.categories where id=a.category_id and is_active) then raise exception 'INCOMPLETE_CONTENT' using errcode='23514'; end if;
 w:=private.editor_word_count(r.micro_summary); if w not between 40 and 65 then raise exception 'SUMMARY_LENGTH' using errcode='23514'; end if;
 if jsonb_array_length(r.full_paragraphs)=0 or exists(select 1 from jsonb_array_elements(r.full_paragraphs) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}'))=0) then raise exception 'PARAGRAPHS_REQUIRED' using errcode='23514'; end if;
 select private.editor_word_count(string_agg(x#>>'{}',' ')) into w from jsonb_array_elements(r.full_paragraphs) x; if w not between 150 and 250 then raise exception 'BODY_LENGTH' using errcode='23514'; end if;
 if not exists(select 1 from private.article_sources where revision_id=r.id and length(btrim(citation_key))>0 and length(btrim(source_name))>0) then raise exception 'SOURCE_REQUIRED' using errcode='23514'; end if;
 if not exists(select 1 from jsonb_array_elements_text(r.full_paragraphs) p, lateral regexp_matches(p, '\[([A-Za-z0-9_-]+)\]', 'g') m) then raise exception 'INLINE_CITATION_REQUIRED' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements_text(r.full_paragraphs) p, lateral regexp_matches(p, '\[([A-Za-z0-9_-]+)\]', 'g') m where not exists(select 1 from private.article_sources s where s.revision_id=r.id and s.citation_key=m[1])) then raise exception 'INVALID_INLINE_CITATION' using errcode='23514'; end if;
 if (select count(*) from private.opinions where revision_id=r.id)<>8 then raise exception 'EIGHT_OPINIONS_REQUIRED' using errcode='23514'; end if;
 if exists(select 1 from private.opinions where revision_id=r.id and (length(btrim(body))=0 or private.editor_word_count(body) not between 40 and 80)) then raise exception 'OPINION_LENGTH' using errcode='23514'; end if;
 update private.articles set status='published',approved_by=uid,published_at=now(),version=version+1,updated_at=now() where id=a.id returning * into a;
 insert into private.editorial_events(article_id,event_type,actor_id) values(a.id,'publish',uid);
 return jsonb_build_object('id',a.id,'status',a.status,'version',a.version,'publishedAt',a.published_at);
end $$;

create or replace function api.editor_withdraw(p_id uuid,p_expected_version integer,p_reason text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 select * into a from private.articles where id=p_id for update; if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status<>'published' or a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 update private.articles set status='withdrawn',withdrawn_at=now(),withdrawal_reason=p_reason,version=version+1,updated_at=now() where id=a.id returning * into a;
 insert into private.editorial_events(article_id,event_type,actor_id,reason) values(a.id,'withdraw',uid,p_reason);
 return jsonb_build_object('id',a.id,'status',a.status,'version',a.version);
end $$;

create or replace function api.editor_correct(p_id uuid,p_expected_version integer,p_data jsonb,p_reason text,p_confirm boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype; saved jsonb; reviewed jsonb; published jsonb; existing_events uuid[];
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_confirm is distinct from true then raise exception 'APPROVAL_REQUIRED' using errcode='22023'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 select * into a from private.articles where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status <> 'published' or a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into existing_events from private.editorial_events where article_id=a.id;
 update private.articles set status='draft' where id=a.id;
 saved:=api.editor_save(a.id,a.version,p_data);
 update private.article_revisions set correction_note=p_reason where id=(saved->>'revisionId')::uuid;
 reviewed:=api.editor_review(a.id,(saved->>'version')::integer);
 published:=api.editor_publish(a.id,(reviewed->>'version')::integer,(reviewed->>'revisionId')::uuid,reviewed->>'reviewHash',true);
 update private.articles set published_at=a.published_at where id=a.id;
 update private.editorial_events set event_type='correct',reason=p_reason where article_id=a.id and event_type='publish' and not(id=any(existing_events));
 return jsonb_build_object('id',a.id,'status','published','version',(published->>'version')::integer,'publishedAt',a.published_at);
end $$;

reset role;
revoke create on schema api from riuya_editor_executor;

