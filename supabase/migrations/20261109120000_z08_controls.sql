-- Fail closed: no label used in a frozen revision can change beneath its review.
create or replace function private.aspect_label_guard() returns trigger language plpgsql set search_path='' as $$
declare cat uuid; st text;
begin
 cat:=case when tg_op='DELETE' then old.catalog_id else new.catalog_id end;
 if tg_op='UPDATE' and old.catalog_id<>new.catalog_id then raise exception 'ASPECT_CATALOG_IMMUTABLE';end if;
 select status into st from private.aspect_catalogs where id=cat for update;
 if st<>'proposed' then raise exception 'ASPECT_CATALOG_LOCKED';end if;
 if tg_op<>'INSERT' and exists(select 1 from private.opinion_aspects x join private.opinions o on o.id=x.opinion_id join private.article_revisions r on r.id=o.revision_id join private.articles a on a.id=r.article_id where x.label_id=old.id and a.status in ('review','published','withdrawn')) then raise exception 'ASPECT_REVISION_LOCKED';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create table private.metric_controls(
 metric text primary key check(metric in ('coincidence','aspects')),
 formula_version text not null,
 enabled boolean not null default false,
 validated_at timestamptz,
 validated_by uuid references private.profiles(id) on delete restrict,
 check(not enabled or (validated_at is not null and validated_by is not null))
);
insert into private.metric_controls(metric,formula_version) values ('coincidence','T07-v1'),('aspects','T07-v1');
alter table private.metric_controls enable row level security;
revoke all on private.metric_controls from public,anon,authenticated;

-- Internal computational primitive. No API grants: the validation and release
-- workflow must be implemented before this can be reached by a user.
create function private.coincidence_t07(p_article_id uuid,p_user_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with participants as materialized (
  select p.id,p.user_id,p.choice_kind,
   case when p.choice_kind='none' then array['none']::text[]
    else coalesce((select array_agg(distinct c.stable_key order by c.stable_key) from private.participation_choices pc join private.opinions o on o.id=pc.opinion_id join private.characters c on c.id=o.character_id where pc.participation_id=p.id),'{}'::text[]) end keys
  from private.participations p where p.article_id=p_article_id
 ),
 own as (select * from participants where user_id=p_user_id),
 compared as (
  select (select count(*) from (select unnest(o.keys) intersect select unnest(p.keys)) i)::numeric /
         nullif((select count(*) from (select unnest(o.keys) union select unnest(p.keys)) u),0) similarity
  from own o join participants p on p.user_id<>o.user_id
 ),
 stats as (select count(*)::int n,(select count(*) from compared)::int peers,(select avg(similarity) from compared) avg_j from participants)
 select case when not exists(select 1 from own) then jsonb_build_object('state','not_applicable')
 when n<10 or peers<9 then jsonb_build_object('state','insufficient_data')
 else jsonb_build_object('state','available','formulaVersion','T07-v1','percentage',round(100*avg_j,1)) end from stats
$$;
revoke all on function private.coincidence_t07(uuid,uuid) from public,anon,authenticated;
