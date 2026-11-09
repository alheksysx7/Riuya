-- Z03: acceso de lectura acotado a noticias publicadas y catálogos.
create index published_feed on private.articles(published_at desc,id desc) where status='published';
create index published_category_feed on private.articles(category_id,published_at desc,id desc) where status='published';
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_reader_executor') then create role riuya_reader_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;
grant riuya_reader_executor to postgres with inherit false;
grant usage on schema private to riuya_reader_executor;
grant select on private.articles,private.article_revisions,private.article_sources,private.opinions,private.characters,private.categories to riuya_reader_executor;
create policy reader_articles on private.articles for select to riuya_reader_executor using(status='published');
create policy reader_revisions on private.article_revisions for select to riuya_reader_executor using(exists(select 1 from private.articles a where a.current_revision_id=private.article_revisions.id and a.status='published'));
create policy reader_sources on private.article_sources for select to riuya_reader_executor using(exists(select 1 from private.articles a where a.current_revision_id=revision_id and a.status='published'));
create policy reader_opinions on private.opinions for select to riuya_reader_executor using(exists(select 1 from private.articles a where a.current_revision_id=revision_id and a.status='published'));
create policy reader_characters on private.characters for select to riuya_reader_executor using(is_active);
create policy reader_categories on private.categories for select to riuya_reader_executor using(true);
grant usage,create on schema api to riuya_reader_executor;

create function api.reader_feed(p_category text default null,p_cursor jsonb default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare upper_time timestamptz; upper_id uuid; last_time timestamptz; last_id uuid; result jsonb;
begin
 if p_category is not null and not exists(select 1 from private.categories where slug=p_category and is_active) then raise exception 'INVALID_CATEGORY' using errcode='22023'; end if;
 if p_cursor is not null then
  begin
   if jsonb_typeof(p_cursor) is distinct from 'object' or (p_cursor->>'category') is distinct from p_category or (select count(*) from jsonb_object_keys(p_cursor))<>5 then raise exception 'INVALID_CURSOR'; end if;
   upper_time:=(p_cursor->>'upperTime')::timestamptz; upper_id:=(p_cursor->>'upperId')::uuid; last_time:=(p_cursor->>'lastTime')::timestamptz; last_id:=(p_cursor->>'lastId')::uuid;
   if upper_time is null or upper_id is null or last_time is null or last_id is null or (last_time,last_id)>(upper_time,upper_id) then raise exception 'INVALID_CURSOR'; end if;
  exception when others then raise exception 'INVALID_CURSOR' using errcode='22023'; end;
 else
  select a.published_at,a.id into upper_time,upper_id from private.articles a join private.categories c on c.id=a.category_id where a.status='published' and (p_category is null or c.slug=p_category) order by a.published_at desc,a.id desc limit 1;
 end if;
 with page as materialized (
  select a.id,a.published_at,r.title,r.micro_summary,c.name category,c.slug from private.articles a join private.article_revisions r on r.id=a.current_revision_id join private.categories c on c.id=a.category_id
  where a.status='published' and (p_category is null or c.slug=p_category) and (a.published_at,a.id)<=(upper_time,upper_id) and (last_time is null or (a.published_at,a.id)<(last_time,last_id)) order by a.published_at desc,a.id desc limit 11
 ), first_ten as (select * from page order by published_at desc,id desc limit 10)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'publishedAt',published_at,'title',title,'summary',micro_summary,'category',category,'categorySlug',slug) order by published_at desc,id desc) from first_ten),'[]'::jsonb),
 'hasMore',(select count(*)>10 from page),'nextCursor',case when (select count(*)>10 from page) then (select jsonb_build_object('category',p_category,'upperTime',upper_time,'upperId',upper_id,'lastTime',published_at,'lastId',id) from first_ten order by published_at asc,id asc limit 1) else null end) into result;
 return result;
end $$;

create function api.reader_article(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'revisionId',r.id,'title',r.title,'summary',r.micro_summary,'paragraphs',r.full_paragraphs,'publishedAt',a.published_at,'category',cat.name,
 'sources',coalesce((select jsonb_agg(jsonb_build_object('key',s.citation_key,'name',s.source_name,'date',s.source_date,'url',s.url) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),
 'opinions',coalesce((select jsonb_agg(jsonb_build_object('characterKey',c.stable_key,'name',c.name,'body',o.body) order by c.order_index) from private.opinions o join private.characters c on c.id=o.character_id where o.revision_id=r.id),'[]'::jsonb))
 from private.articles a join private.article_revisions r on r.id=a.current_revision_id join private.categories cat on cat.id=a.category_id where a.id=p_id and a.status='published'
$$;
create function api.reader_character(p_key text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('key',stable_key,'name',name,'biography',biography,'traits',traits,'canonVersion',canon_version) from private.characters where stable_key=p_key and is_active
$$;
alter function api.reader_feed(text,jsonb) owner to riuya_reader_executor;
alter function api.reader_article(uuid) owner to riuya_reader_executor;
alter function api.reader_character(text) owner to riuya_reader_executor;
revoke create on schema api from riuya_reader_executor;
set local role riuya_reader_executor;
revoke all on function api.reader_feed(text,jsonb),api.reader_article(uuid),api.reader_character(text) from public;
grant execute on function api.reader_feed(text,jsonb),api.reader_article(uuid),api.reader_character(text) to anon,authenticated;
reset role;

