-- Z05: participación privada y serializada por lector y noticia.
create table private.article_user_state(
 user_id uuid not null references private.profiles(id) on delete cascade,
 article_id uuid not null references private.articles(id),
 omitted_at timestamptz,full_results_seen_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(user_id,article_id)
);
create table private.participations(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references private.profiles(id) on delete cascade,
 article_id uuid not null references private.articles(id),revision_id uuid not null,choice_kind text not null check(choice_kind in ('voices','none')),
 operation_id uuid not null,payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),confirmed_at timestamptz not null default now(),
 unique(user_id,article_id),unique(user_id,operation_id),foreign key(article_id,revision_id) references private.article_revisions(article_id,id)
);
create table private.participation_choices(
 participation_id uuid not null references private.participations(id) on delete cascade,
 opinion_id uuid not null references private.opinions(id),primary key(participation_id,opinion_id)
);
create index participation_history on private.participations(user_id,confirmed_at desc,id desc);
create index participation_article on private.participations(article_id);
alter table private.article_user_state enable row level security;
alter table private.participations enable row level security;
alter table private.participation_choices enable row level security;
revoke all on private.article_user_state,private.participations,private.participation_choices from public,anon,authenticated;

do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_participation_executor') then create role riuya_participation_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;
grant riuya_participation_executor to postgres with inherit false;
grant usage on schema private,extensions to riuya_participation_executor;
grant select,update on private.profiles,private.articles to riuya_participation_executor;
grant select on private.article_revisions,private.opinions to riuya_participation_executor;
grant select,insert,update on private.article_user_state to riuya_participation_executor;
grant select,insert on private.participations,private.participation_choices to riuya_participation_executor;
create policy participation_profiles on private.profiles for select to riuya_participation_executor using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy participation_profiles_lock on private.profiles for update to riuya_participation_executor using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(false);
create policy participation_articles on private.articles for select to riuya_participation_executor using(status='published');
create policy participation_articles_lock on private.articles for update to riuya_participation_executor using(status='published') with check(false);
create policy participation_revisions on private.article_revisions for select to riuya_participation_executor using(exists(select 1 from private.articles a where a.current_revision_id=private.article_revisions.id));
create policy participation_opinions on private.opinions for select to riuya_participation_executor using(exists(select 1 from private.articles a where a.current_revision_id=private.opinions.revision_id));
create policy participation_state on private.article_user_state for all to riuya_participation_executor using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy participation_own on private.participations for all to riuya_participation_executor using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy participation_choices_own on private.participation_choices for all to riuya_participation_executor using(exists(select 1 from private.participations p where p.id=participation_id)) with check(exists(select 1 from private.participations p where p.id=participation_id));

-- Invariante cruzada diferible, incluso para escrituras SQL accidentales.
create function private.check_participation_choices() returns trigger language plpgsql set search_path='' as $$
declare pid uuid; p private.participations%rowtype; n integer;
begin
 if tg_table_name='participations' then pid:=coalesce(new.id,old.id); else pid:=coalesce(new.participation_id,old.participation_id); end if;
 select * into p from private.participations where id=pid; if not found then return null; end if;
 select count(*) into n from private.participation_choices where participation_id=pid;
 if (p.choice_kind='none' and n<>0) or (p.choice_kind='voices' and n not between 1 and 8) or exists(select 1 from private.participation_choices c left join private.opinions o on o.id=c.opinion_id where c.participation_id=pid and (o.id is null or o.revision_id<>p.revision_id)) then raise exception 'INVALID_PARTICIPATION_INVARIANT' using errcode='23514'; end if;
 return null;
end $$;
revoke all on function private.check_participation_choices() from public;
create constraint trigger participation_choices_on_parent after insert or update on private.participations deferrable initially deferred for each row execute function private.check_participation_choices();
create constraint trigger participation_choices_on_child after insert or update or delete on private.participation_choices deferrable initially deferred for each row execute function private.check_participation_choices();
grant execute on function private.check_participation_choices() to riuya_participation_executor;
grant usage,create on schema api to riuya_participation_executor;

create function api.confirm_participation(p_article_id uuid,p_revision_id uuid,p_operation_id uuid,p_choice_kind text,p_opinion_ids uuid[]) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text; a private.articles%rowtype; state private.article_user_state%rowtype; existing private.participations%rowtype; canonical uuid[]; hash text; result private.participations%rowtype;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
 select account_status into account_state from private.profiles where id=uid for share;
 if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501'; end if;
 select * into a from private.articles where id=p_article_id for share;
 if not found then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
 if p_revision_id is distinct from a.current_revision_id then raise exception 'CONTENT_CHANGED' using errcode='PT409'; end if;
 if p_operation_id is null or (p_choice_kind is null or p_choice_kind not in ('voices','none')) or p_opinion_ids is null or array_position(p_opinion_ids,null) is not null then raise exception 'INVALID_SELECTION' using errcode='22023'; end if;
 if cardinality(p_opinion_ids)<>(select count(distinct x) from unnest(p_opinion_ids) x) or (p_choice_kind='none' and cardinality(p_opinion_ids)<>0) or (p_choice_kind='voices' and cardinality(p_opinion_ids) not between 1 and 8) then raise exception 'INVALID_SELECTION' using errcode='22023'; end if;
 select coalesce(array_agg(x order by x),'{}'::uuid[]) into canonical from unnest(p_opinion_ids) x;
 hash:=encode(extensions.digest(convert_to(jsonb_build_object('article',p_article_id,'revision',p_revision_id,'kind',p_choice_kind,'opinions',to_jsonb(canonical))::text,'UTF8'),'sha256'),'hex');
 insert into private.article_user_state(user_id,article_id) values(uid,a.id) on conflict(user_id,article_id) do nothing;
 select * into state from private.article_user_state where user_id=uid and article_id=a.id for update;
 select * into existing from private.participations where user_id=uid and operation_id=p_operation_id;
 if found then if existing.payload_hash is distinct from hash then raise exception 'OPERATION_CONFLICT' using errcode='PT409'; end if; return jsonb_build_object('id',existing.id,'status','confirmed','choiceKind',existing.choice_kind,'confirmedAt',existing.confirmed_at); end if;
 select * into existing from private.participations where user_id=uid and article_id=a.id;
 if found then raise exception 'ALREADY_CONFIRMED' using errcode='PT409'; end if;
 if state.full_results_seen_at is not null then raise exception 'PARTICIPATION_LOCKED' using errcode='PT409'; end if;
 if exists(select 1 from unnest(canonical) x where not exists(select 1 from private.opinions o where o.id=x and o.revision_id=a.current_revision_id)) then raise exception 'INVALID_OPINION' using errcode='22023'; end if;
 begin insert into private.participations(user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) values(uid,a.id,p_revision_id,p_choice_kind,p_operation_id,hash) returning * into result;
 exception when unique_violation then raise exception 'OPERATION_CONFLICT' using errcode='PT409'; end;
 insert into private.participation_choices(participation_id,opinion_id) select result.id,x from unnest(canonical) x;
 return jsonb_build_object('id',result.id,'status','confirmed','choiceKind',result.choice_kind,'confirmedAt',result.confirmed_at);
end $$;

create function api.participation_state(p_article_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text; p private.participations%rowtype; s private.article_user_state%rowtype;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
 select account_status into account_state from private.profiles where id=uid; if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501'; end if;
 if not exists(select 1 from private.articles where id=p_article_id and status='published') then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
 select * into p from private.participations where user_id=uid and article_id=p_article_id;
 if found then return jsonb_build_object('status','confirmed','id',p.id,'revisionId',p.revision_id,'choiceKind',p.choice_kind,'opinionIds',coalesce((select jsonb_agg(opinion_id order by opinion_id) from private.participation_choices where participation_id=p.id),'[]'::jsonb),'confirmedAt',p.confirmed_at); end if;
 select * into s from private.article_user_state where user_id=uid and article_id=p_article_id;
 return jsonb_build_object('status',case when s.omitted_at is null then 'pending' else 'omitted' end,'omittedAt',s.omitted_at,'locked',s.full_results_seen_at is not null);
end $$;

create function api.omit_article(p_article_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text; a private.articles%rowtype; s private.article_user_state%rowtype; next_id uuid;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
 select account_status into account_state from private.profiles where id=uid for share; if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501'; end if;
 select * into a from private.articles where id=p_article_id for share; if not found then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
 insert into private.article_user_state(user_id,article_id) values(uid,a.id) on conflict(user_id,article_id) do nothing;
 select * into s from private.article_user_state where user_id=uid and article_id=a.id for update;
 if exists(select 1 from private.participations where user_id=uid and article_id=a.id) then raise exception 'ALREADY_CONFIRMED' using errcode='PT409'; end if;
 if s.omitted_at is null then update private.article_user_state set omitted_at=now(),updated_at=now() where user_id=uid and article_id=a.id returning * into s; end if;
 select x.id into next_id from private.articles x where x.status='published' and (x.published_at,x.id)<(a.published_at,a.id) order by x.published_at desc,x.id desc limit 1;
 return jsonb_build_object('status','omitted','omittedAt',s.omitted_at,'nextArticleId',next_id);
end $$;
alter function api.confirm_participation(uuid,uuid,uuid,text,uuid[]) owner to riuya_participation_executor;
alter function api.participation_state(uuid) owner to riuya_participation_executor;
alter function api.omit_article(uuid) owner to riuya_participation_executor;
revoke create on schema api from riuya_participation_executor;
set local role riuya_participation_executor;
revoke all on function api.confirm_participation(uuid,uuid,uuid,text,uuid[]),api.participation_state(uuid),api.omit_article(uuid) from public,anon;
grant execute on function api.confirm_participation(uuid,uuid,uuid,text,uuid[]),api.participation_state(uuid),api.omit_article(uuid) to authenticated;
reset role;
