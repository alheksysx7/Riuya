-- Z08: almacenamiento privado; no habilita ni publica las métricas propuestas.
create table private.aspect_catalogs (
 id uuid primary key default gen_random_uuid(),
 version text not null unique check(length(btrim(version)) between 1 and 100),
 status text not null default 'proposed' check(status in ('proposed','validated','retired')),
 validated_at timestamptz, validated_by uuid references private.profiles(id) on delete restrict,
 check ((status='proposed' and validated_at is null and validated_by is null) or (status in ('validated','retired') and validated_at is not null and validated_by is not null))
);
create table private.aspect_labels (
 id uuid primary key default gen_random_uuid(), catalog_id uuid not null references private.aspect_catalogs(id),
 dimension text not null check(dimension in ('emotion','approach','stance')),
 label_key text not null check(label_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
 definition text not null check(length(btrim(definition))>0),
 positive_examples jsonb not null check(jsonb_typeof(positive_examples)='array' and jsonb_array_length(positive_examples)>0),
 negative_examples jsonb not null check(jsonb_typeof(negative_examples)='array' and jsonb_array_length(negative_examples)>0),
 unique(catalog_id,dimension,label_key),unique(id,dimension)
);
create table private.opinion_aspects (
 opinion_id uuid not null references private.opinions(id),
 label_id uuid not null, dimension text not null,
 weight_basis_points integer not null check(weight_basis_points in (10000,7000,3000,6000,2500,1500)),
 evidence text not null check(length(btrim(evidence))>0),
 reviewed_by uuid references private.profiles(id) on delete restrict,
 second_reviewed_by uuid references private.profiles(id) on delete restrict,
 primary key(opinion_id,label_id),
 foreign key(label_id,dimension) references private.aspect_labels(id,dimension),
 check(second_reviewed_by is null or (reviewed_by is not null and second_reviewed_by<>reviewed_by))
);
alter table private.aspect_catalogs enable row level security;
alter table private.aspect_labels enable row level security;
alter table private.opinion_aspects enable row level security;
revoke all on private.aspect_catalogs,private.aspect_labels,private.opinion_aspects from public,anon,authenticated;

-- Lock the opinion first: concurrent annotation transactions cannot interleave.
create function private.aspect_before_change() returns trigger language plpgsql set search_path='' as $$
declare oid uuid; state text;
begin
 oid:=case when tg_op='DELETE' then old.opinion_id else new.opinion_id end;
 if tg_op='UPDATE' and new.opinion_id<>old.opinion_id then raise exception 'ASPECT_OPINION_IMMUTABLE'; end if;
 select a.status into state from private.opinions o join private.article_revisions r on r.id=o.revision_id join private.articles a on a.id=r.article_id where o.id=oid for update of o;
 if state in ('review','published','withdrawn') then raise exception 'ASPECT_REVISION_LOCKED'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger aspect_before_change before insert or update or delete on private.opinion_aspects for each row execute function private.aspect_before_change();

-- Validate the complete dimension at transaction end to permit replacement atomically.
create function private.aspect_validate_weights() returns trigger language plpgsql set search_path='' as $$
declare oid uuid; dim text; weights integer[];
begin
 oid:=case when tg_op='DELETE' then old.opinion_id else new.opinion_id end;
 for dim in select distinct d from (values (case when tg_op<>'INSERT' then old.dimension end),(case when tg_op<>'DELETE' then new.dimension end)) x(d) where d is not null loop
  select array_agg(weight_basis_points order by weight_basis_points desc) into weights from private.opinion_aspects where opinion_id=oid and dimension=dim;
  if weights is not null and weights not in (array[10000],array[7000,3000],array[6000,2500,1500]) then raise exception 'INVALID_ASPECT_WEIGHTS' using errcode='23514';end if;
 end loop;
 return null;
end $$;
create constraint trigger aspect_weights after insert or update or delete on private.opinion_aspects deferrable initially deferred for each row execute function private.aspect_validate_weights();

create function private.aspect_label_guard() returns trigger language plpgsql set search_path='' as $$
declare cat uuid; st text;
begin
 cat:=case when tg_op='DELETE' then old.catalog_id else new.catalog_id end;
 if tg_op='UPDATE' and old.catalog_id<>new.catalog_id then raise exception 'ASPECT_CATALOG_IMMUTABLE';end if;
 select status into st from private.aspect_catalogs where id=cat for update;
 if st<>'proposed' then raise exception 'ASPECT_CATALOG_LOCKED';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger aspect_label_guard before insert or update or delete on private.aspect_labels for each row execute function private.aspect_label_guard();

-- Validated catalog metadata is frozen; retirement is one-way.
create function private.aspect_catalog_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status in ('validated','retired') and (new.version is distinct from old.version or new.validated_at is distinct from old.validated_at or new.validated_by is distinct from old.validated_by or new.status not in (old.status,'retired')) then raise exception 'ASPECT_CATALOG_LOCKED';end if;
 return new;
end $$;
create trigger aspect_catalog_guard before update on private.aspect_catalogs for each row execute function private.aspect_catalog_guard();

-- Include evidence and both reviewers in the exact editorial revision fingerprint.
grant select on private.opinion_aspects to riuya_editor_executor;
create policy editor_aspects_read on private.opinion_aspects for select to riuya_editor_executor using(true);
create or replace function private.editor_revision_hash(p_revision_id uuid) returns text language sql stable set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('revision',to_jsonb(r),'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.citation_key) from private.article_sources s where s.revision_id=r.id),'[]'::jsonb),'opinions',coalesce((select jsonb_agg(to_jsonb(o) order by o.character_id) from private.opinions o where o.revision_id=r.id),'[]'::jsonb),'aspects',coalesce((select jsonb_agg(to_jsonb(oa) order by oa.opinion_id,oa.label_id) from private.opinion_aspects oa join private.opinions o on o.id=oa.opinion_id where o.revision_id=r.id),'[]'::jsonb))::text,'UTF8'),'sha256'),'hex') from private.article_revisions r where r.id=p_revision_id
$$;
revoke all on function private.aspect_before_change(),private.aspect_validate_weights(),private.aspect_label_guard(),private.aspect_catalog_guard() from public;
