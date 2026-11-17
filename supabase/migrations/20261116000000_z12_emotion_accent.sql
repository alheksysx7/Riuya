-- Acento editorial público: únicamente una clave aprobada, nunca evidencia o revisores.
grant create on schema private to riuya_results_executor;
set local role riuya_results_executor;
create function private.reader_emotion_accent(p_opinion uuid) returns text
language sql stable security definer set search_path='' as $$
 with eligible as (
  select oa.weight_basis_points,l.label_key
  from private.opinion_aspects oa
  join private.aspect_labels l on l.id=oa.label_id and l.dimension=oa.dimension
  join private.aspect_catalogs cat on cat.id=l.catalog_id and cat.status='validated'
  join private.metric_controls mc on mc.metric='aspects' and mc.catalog_id=cat.id and mc.enabled
   and mc.formula_version='T07-v1' and mc.validated_at is not null and mc.validated_by is not null
  join private.opinions o on o.id=oa.opinion_id
  join private.articles a on a.current_revision_id=o.revision_id and a.status='published'
  where oa.opinion_id=p_opinion and oa.dimension='emotion'
   and private.aspect_independent_agreement(oa.opinion_id,'emotion')
 ), top_weight as (select max(weight_basis_points) weight from eligible)
 select case when count(*)=1 and max(label_key) in ('empatia','inquietud','indignacion','esperanza','alegria','tristeza','frustracion','nostalgia')
  then max(label_key) else null end
 from eligible,top_weight
 where eligible.weight_basis_points=top_weight.weight
  and (select count(*) from eligible)=(select count(*) from private.opinion_aspects where opinion_id=p_opinion and dimension='emotion')
$$;
revoke all on function private.reader_emotion_accent(uuid) from public,anon,authenticated;
grant execute on function private.reader_emotion_accent(uuid) to riuya_reader_executor;
reset role;
revoke create on schema private from riuya_results_executor;

grant create on schema api to riuya_reader_executor;
set local role riuya_reader_executor;
create or replace function api.reader_article(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'revisionId',r.id,'title',r.title,'summary',r.micro_summary,'paragraphs',r.full_paragraphs,'publishedAt',a.published_at,'category',cat.name,
 'sources',coalesce((select jsonb_agg(jsonb_build_object('key',s.citation_key,'name',s.source_name,'date',s.source_date,'url',s.url) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),
 'opinions',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'characterKey',c.stable_key,'name',c.name,'body',o.body,'emotionAccent',private.reader_emotion_accent(o.id)) order by c.order_index) from private.opinions o join private.characters c on c.id=o.character_id where o.revision_id=r.id),'[]'::jsonb))
 from private.articles a join private.article_revisions r on r.id=a.current_revision_id join private.categories cat on cat.id=a.category_id where a.id=p_id and a.status='published'
$$;
reset role;
revoke create on schema api from riuya_reader_executor;

-- La comprobación de salud reconoce esta versión y sigue rechazando futuras.
create or replace function api.health_schema_compatible()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from supabase_migrations.schema_migrations where version='20261116000000')
  and not exists(select 1 from supabase_migrations.schema_migrations where version !~ '^[0-9]{14}$' or version>'20261116000000')
$$;
