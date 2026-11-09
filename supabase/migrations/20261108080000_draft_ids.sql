grant create on schema api to riuya_reader_executor;
set local role riuya_reader_executor;
create or replace function api.reader_article(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'revisionId',r.id,'title',r.title,'summary',r.micro_summary,'paragraphs',r.full_paragraphs,'publishedAt',a.published_at,'category',cat.name,
 'sources',coalesce((select jsonb_agg(jsonb_build_object('key',s.citation_key,'name',s.source_name,'date',s.source_date,'url',s.url) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),
 'opinions',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'characterKey',c.stable_key,'name',c.name,'body',o.body) order by c.order_index) from private.opinions o join private.characters c on c.id=o.character_id where o.revision_id=r.id),'[]'::jsonb))
 from private.articles a join private.article_revisions r on r.id=a.current_revision_id join private.categories cat on cat.id=a.category_id where a.id=p_id and a.status='published'
$$;
reset role;
revoke create on schema api from riuya_reader_executor;
