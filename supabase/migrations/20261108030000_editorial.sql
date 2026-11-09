-- Z02: borradores editoriales y revisiones. No conceder acceso directo a clientes.
create table private.events (
 id uuid primary key default gen_random_uuid(), title text not null check (length(btrim(title)) between 1 and 300),
 created_at timestamptz not null default now()
);
create table private.articles (
 id uuid primary key default gen_random_uuid(), event_id uuid references private.events(id),
 category_id uuid not null references private.categories(id),
 status text not null default 'draft' check (status in ('draft','review','published','withdrawn')),
 version integer not null default 1 check (version > 0),
 current_revision_id uuid,
 created_by uuid references private.profiles(id) on delete set null,
 approved_by uuid references private.profiles(id) on delete set null,
 published_at timestamptz, withdrawn_at timestamptz,
 withdrawal_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (status not in ('published','withdrawn') or (published_at is not null and current_revision_id is not null)),
 check (status <> 'withdrawn' or (withdrawn_at is not null and length(btrim(withdrawal_reason)) > 0))
);
create table private.article_revisions (
 id uuid primary key default gen_random_uuid(), article_id uuid not null references private.articles(id),
 revision_number integer not null check (revision_number > 0), title text not null,
 micro_summary text not null, full_paragraphs jsonb not null check (jsonb_typeof(full_paragraphs)='array'),
 correction_note text, created_by uuid references private.profiles(id) on delete set null,
 created_at timestamptz not null default now(), unique(article_id,revision_number), unique(article_id,id)
);
alter table private.articles add constraint current_revision_belongs_to_article foreign key(id,current_revision_id) references private.article_revisions(article_id,id);
create table private.article_sources (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references private.article_revisions(id),
 citation_key text not null, source_name text not null, source_date date not null,
 url text not null check (url ~ '^https?://'), unique(revision_id,citation_key)
);
create table private.opinions (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references private.article_revisions(id),
 character_id uuid not null references private.characters(id), body text not null,
 unique(revision_id,character_id)
);
create table private.editorial_events (
 id uuid primary key default gen_random_uuid(), article_id uuid not null references private.articles(id),
 event_type text not null check (event_type in ('publish','correct','withdraw')),
 actor_id uuid references private.profiles(id) on delete set null, occurred_at timestamptz not null default now(), reason text
);
alter table private.events enable row level security;
alter table private.articles enable row level security;
alter table private.article_revisions enable row level security;
alter table private.article_sources enable row level security;
alter table private.opinions enable row level security;
alter table private.editorial_events enable row level security;
revoke all on private.events,private.articles,private.article_revisions,private.article_sources,private.opinions,private.editorial_events from public,anon,authenticated;

do $$ begin if not exists (select 1 from pg_roles where rolname='riuya_editor_executor') then create role riuya_editor_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;
grant riuya_editor_executor to postgres with inherit false;
grant usage on schema private, extensions to riuya_editor_executor;
grant select on private.profiles,private.user_roles,private.characters,private.categories to riuya_editor_executor;
grant select,insert,update on private.articles,private.article_revisions,private.article_sources,private.opinions,private.editorial_events to riuya_editor_executor;
create policy editor_profiles on private.profiles for select to riuya_editor_executor using (true);
create policy editor_roles on private.user_roles for select to riuya_editor_executor using (true);
create policy editor_characters on private.characters for select to riuya_editor_executor using (true);
create policy editor_categories on private.categories for select to riuya_editor_executor using (true);
create policy editor_articles on private.articles for all to riuya_editor_executor using (true) with check (true);
create policy editor_revisions on private.article_revisions for all to riuya_editor_executor using (true) with check (true);
create policy editor_sources on private.article_sources for all to riuya_editor_executor using (true) with check (true);
create policy editor_opinions on private.opinions for all to riuya_editor_executor using (true) with check (true);
create policy editor_events on private.editorial_events for all to riuya_editor_executor using (true) with check (true);
grant usage,create on schema api to riuya_editor_executor;

create function api.editor_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; result jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'version',a.version,'title',r.title,'publishedAt',a.published_at) order by a.created_at desc),'[]'::jsonb) into result from private.articles a left join private.article_revisions r on r.id=a.current_revision_id;
 return result;
end $$;

create function api.editor_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; result jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select jsonb_build_object('id',a.id,'status',a.status,'version',a.version,'categoryId',a.category_id,'revisionId',r.id,'reviewHash',case when a.status='review' then private.editor_revision_hash(r.id) else null end,'title',r.title,'summary',r.micro_summary,'paragraphs',r.full_paragraphs,'sources',coalesce((select jsonb_agg(jsonb_build_object('key',s.citation_key,'name',s.source_name,'date',s.source_date,'url',s.url) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),'opinions',coalesce((select jsonb_agg(jsonb_build_object('characterKey',c.stable_key,'body',o.body) order by c.order_index) from private.opinions o join private.characters c on c.id=o.character_id where o.revision_id=r.id),'[]'::jsonb)) into result from private.articles a join private.article_revisions r on r.id=a.current_revision_id where a.id=p_id;
 if result is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if; return result;
end $$;

create function api.editor_save(p_id uuid,p_expected_version integer,p_data jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
  if p_expected_version is distinct from a.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
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

-- La revisión se identifica por una huella estable del contenido persistido.
create function private.editor_revision_hash(p_revision_id uuid) returns text language sql stable set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('revision',to_jsonb(r),'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),'opinions',coalesce((select jsonb_agg(to_jsonb(o) order by o.character_id) from private.opinions o where o.revision_id=r.id),'[]'::jsonb))::text,'UTF8'),'sha256'),'hex') from private.article_revisions r where r.id=p_revision_id
$$;
revoke all on function private.editor_revision_hash(uuid) from public;
grant execute on function private.editor_revision_hash(uuid) to riuya_editor_executor;
create function private.editor_word_count(p_text text) returns integer language sql immutable set search_path='' as $$
 select case when cleaned='' then 0 else cardinality(regexp_split_to_array(cleaned,'[[:space:]]+')) end from (select btrim(regexp_replace(regexp_replace(regexp_replace(translate(coalesce(p_text,''),E'\u00a0\u202f','  '),'https?://[^[:space:]]+','','gi'),'\[[A-Za-z0-9_-]+\]','','g'),'[[:space:]]+',' ','g')) cleaned) x
$$;
revoke all on function private.editor_word_count(text) from public;
grant execute on function private.editor_word_count(text) to riuya_editor_executor;
create function api.editor_review(p_id uuid,p_expected_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into a from private.articles where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status not in ('draft','review') or a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 update private.articles set status='review',version=version+1,updated_at=now() where id=a.id returning * into a;
 return jsonb_build_object('id',a.id,'status',a.status,'version',a.version,'revisionId',a.current_revision_id,'reviewHash',private.editor_revision_hash(a.current_revision_id));
end $$;
create function api.editor_catalog() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) from private.categories where is_active),'characters',(select coalesce(jsonb_agg(jsonb_build_object('key',stable_key,'name',name) order by order_index),'[]'::jsonb) from private.characters where is_active));
end $$;

create function api.editor_publish(p_id uuid,p_expected_version integer,p_revision_id uuid,p_review_hash text,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype; r private.article_revisions%rowtype; w integer;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into a from private.articles where id=p_id for update; if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status <> 'review' or a.version is distinct from p_expected_version or a.current_revision_id is distinct from p_revision_id or p_review_hash is distinct from private.editor_revision_hash(a.current_revision_id) then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
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

create function api.editor_withdraw(p_id uuid,p_expected_version integer,p_reason text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 select * into a from private.articles where id=p_id for update; if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status<>'published' or a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 update private.articles set status='withdrawn',withdrawn_at=now(),withdrawal_reason=p_reason,version=version+1,updated_at=now() where id=a.id returning * into a;
 insert into private.editorial_events(article_id,event_type,actor_id,reason) values(a.id,'withdraw',uid,p_reason);
 return jsonb_build_object('id',a.id,'status',a.status,'version',a.version);
end $$;

alter function api.editor_review(uuid,integer) owner to riuya_editor_executor;
alter function api.editor_catalog() owner to riuya_editor_executor;
alter function api.editor_list() owner to riuya_editor_executor;
alter function api.editor_get(uuid) owner to riuya_editor_executor;
alter function api.editor_save(uuid,integer,jsonb) owner to riuya_editor_executor;
alter function api.editor_publish(uuid,integer,uuid,text,boolean) owner to riuya_editor_executor;
alter function api.editor_withdraw(uuid,integer,text) owner to riuya_editor_executor;
revoke create on schema api from riuya_editor_executor;
set local role riuya_editor_executor;
revoke all on function api.editor_review(uuid,integer),api.editor_catalog(),api.editor_list(),api.editor_get(uuid),api.editor_save(uuid,integer,jsonb),api.editor_publish(uuid,integer,uuid,text,boolean),api.editor_withdraw(uuid,integer,text) from public,anon;
grant execute on function api.editor_review(uuid,integer),api.editor_catalog(),api.editor_list(),api.editor_get(uuid),api.editor_save(uuid,integer,jsonb),api.editor_publish(uuid,integer,uuid,text,boolean),api.editor_withdraw(uuid,integer,text) to authenticated;
reset role;

-- Lectura puntual para comprobar la visibilidad; no implementa el feed de Z03.
grant create on schema api to riuya_editor_executor;
create function api.public_article(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'title',r.title,'summary',r.micro_summary,'paragraphs',r.full_paragraphs,
 'sources',coalesce((select jsonb_agg(jsonb_build_object('key',s.citation_key,'name',s.source_name,'date',s.source_date,'url',s.url) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),
 'opinions',coalesce((select jsonb_agg(jsonb_build_object('characterKey',c.stable_key,'body',o.body) order by c.order_index) from private.opinions o join private.characters c on c.id=o.character_id where o.revision_id=r.id),'[]'::jsonb))
 from private.articles a join private.article_revisions r on r.id=a.current_revision_id where a.id=p_id and a.status='published'
$$;
alter function api.public_article(uuid) owner to riuya_editor_executor;
revoke create on schema api from riuya_editor_executor;
set local role riuya_editor_executor;
revoke all on function api.public_article(uuid) from public;
grant execute on function api.public_article(uuid) to anon,authenticated;
reset role;


