-- Serializar la congelación editorial con las escrituras de anotaciones.
create or replace function private.aspect_before_change() returns trigger language plpgsql set search_path='' as $$
declare oid uuid; state text;
begin
 oid:=case when tg_op='DELETE' then old.opinion_id else new.opinion_id end;
 if tg_op='UPDATE' and new.opinion_id<>old.opinion_id then raise exception 'ASPECT_OPINION_IMMUTABLE';end if;
 select a.status into state from private.opinions o join private.article_revisions r on r.id=o.revision_id join private.articles a on a.id=r.article_id where o.id=oid for update of a;
 perform 1 from private.opinions where id=oid for update;
 if state in ('review','published','withdrawn') then raise exception 'ASPECT_REVISION_LOCKED';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

grant select on private.aspect_labels to riuya_editor_executor;
create policy editor_aspect_labels_read on private.aspect_labels for select to riuya_editor_executor using(true);
create or replace function private.editor_revision_hash(p_revision_id uuid) returns text language sql stable set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('revision',to_jsonb(r),'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),'opinions',coalesce((select jsonb_agg(to_jsonb(o) order by o.character_id) from private.opinions o where o.revision_id=r.id),'[]'::jsonb),'aspects',coalesce((select jsonb_agg(jsonb_build_object('annotation',to_jsonb(oa),'label',to_jsonb(l)) order by oa.opinion_id,oa.label_id) from private.opinion_aspects oa join private.aspect_labels l on l.id=oa.label_id join private.opinions o on o.id=oa.opinion_id where o.revision_id=r.id),'[]'::jsonb))::text,'UTF8'),'sha256'),'hex') from private.article_revisions r where r.id=p_revision_id
$$;
