-- Propuestas separadas por revisor. El contenido se conserva para comparar;
-- dos firmas sobre una única propuesta no cuentan como doble anotación.
create table private.aspect_annotation_proposals(
 opinion_id uuid not null references private.opinions(id),
 dimension text not null check(dimension in ('emotion','approach','stance')),
 reviewer_id uuid not null references private.profiles(id) on delete restrict,
 proposal jsonb not null check(jsonb_typeof(proposal)='array' and jsonb_array_length(proposal)<=3),
 created_at timestamptz not null default now(),
 primary key(opinion_id,dimension,reviewer_id)
);
alter table private.aspect_annotation_proposals enable row level security;
revoke all on private.aspect_annotation_proposals from public,anon,authenticated;

-- Comparison only: no direct client grant, no actual validation is implied.
create function private.aspect_independent_agreement(p_opinion uuid,p_dimension text) returns boolean language sql stable security invoker set search_path='' as $$
 with canonical as (
  select coalesce(jsonb_agg(jsonb_build_object('labelId',label_id,'weight',weight_basis_points,'evidence',evidence) order by label_id),'[]'::jsonb) proposal
  from private.opinion_aspects where opinion_id=p_opinion and dimension=p_dimension
 ),
 independent as (
  select count(distinct p.reviewer_id) n
  from private.aspect_annotation_proposals p cross join canonical c
  where p.opinion_id=p_opinion and p.dimension=p_dimension and p.proposal=c.proposal
 )
 select n>=2 from independent
$$;
revoke all on function private.aspect_independent_agreement(uuid,text) from public,anon,authenticated;

-- Each canonical proposal remains frozen alongside the editorial revision.
create function private.aspect_proposal_guard() returns trigger language plpgsql set search_path='' as $$
declare oid uuid; st text;
begin
 oid:=case when tg_op='DELETE' then old.opinion_id else new.opinion_id end;
 if tg_op='UPDATE' and (new.opinion_id<>old.opinion_id or new.dimension<>old.dimension or new.reviewer_id<>old.reviewer_id) then raise exception 'PROPOSAL_ID_IMMUTABLE';end if;
 select a.status into st from private.opinions o join private.article_revisions r on r.id=o.revision_id join private.articles a on a.id=r.article_id where o.id=oid for update of a;
 if st in ('review','published','withdrawn') then raise exception 'ASPECT_REVISION_LOCKED';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger aspect_proposal_guard before insert or update or delete on private.aspect_annotation_proposals for each row execute function private.aspect_proposal_guard();
revoke all on function private.aspect_proposal_guard() from public;
