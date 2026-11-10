-- Z07: historial y tendencias únicamente de la identidad del JWT.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_activity_executor') then create role riuya_activity_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;
grant riuya_activity_executor to postgres with inherit false;
grant usage on schema private to riuya_activity_executor;
grant select on private.profiles,private.articles,private.article_revisions,private.categories,private.article_user_state,private.participations,private.participation_choices,private.opinions,private.characters to riuya_activity_executor;
create policy activity_profile on private.profiles for select to riuya_activity_executor using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy activity_articles on private.articles for select to riuya_activity_executor using(status='published');
create policy activity_revisions on private.article_revisions for select to riuya_activity_executor using(exists(select 1 from private.articles a where a.current_revision_id=private.article_revisions.id));
create policy activity_categories on private.categories for select to riuya_activity_executor using(true);
create policy activity_state on private.article_user_state for select to riuya_activity_executor using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy activity_participations on private.participations for select to riuya_activity_executor using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy activity_choices on private.participation_choices for select to riuya_activity_executor using(exists(select 1 from private.participations p where p.id=private.participation_choices.participation_id));
create policy activity_opinions on private.opinions for select to riuya_activity_executor using(exists(select 1 from private.participation_choices pc where pc.opinion_id=private.opinions.id));
create policy activity_characters on private.characters for select to riuya_activity_executor using(is_active);
grant usage,create on schema api to riuya_activity_executor;

create function api.my_activity(p_filter text default 'all',p_cursor jsonb default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;account_state text;upper_time timestamptz;upper_id uuid;last_time timestamptz;last_id uuid;result jsonb;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;
 select account_status into account_state from private.profiles where id=uid;if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 if p_filter is null or p_filter not in ('all','responded','omitted') then raise exception 'INVALID_FILTER' using errcode='22023';end if;
 if p_cursor is not null then begin
  if jsonb_typeof(p_cursor) is distinct from 'object' or (p_cursor->>'filter') is distinct from p_filter or (select count(*) from jsonb_object_keys(p_cursor))<>5 then raise exception 'INVALID_CURSOR';end if;
  upper_time:=(p_cursor->>'upperTime')::timestamptz;upper_id:=(p_cursor->>'upperId')::uuid;last_time:=(p_cursor->>'lastTime')::timestamptz;last_id:=(p_cursor->>'lastId')::uuid;
  if upper_time is null or upper_id is null or last_time is null or last_id is null or (last_time,last_id)>(upper_time,upper_id) then raise exception 'INVALID_CURSOR';end if;
 exception when others then raise exception 'INVALID_CURSOR' using errcode='22023';end;
 else
  select coalesce(p.confirmed_at,st.omitted_at),a.id into upper_time,upper_id from private.article_user_state st join private.articles a on a.id=st.article_id left join private.participations p on p.user_id=st.user_id and p.article_id=st.article_id where st.user_id=uid and (p.id is not null or st.omitted_at is not null) and (p_filter='all' or (p_filter='responded' and p.id is not null) or (p_filter='omitted' and p.id is null and st.omitted_at is not null)) order by coalesce(p.confirmed_at,st.omitted_at) desc,a.id desc limit 1;
 end if;
 with records as materialized (
  select a.id,r.title,c.name category,case when p.id is not null then 'responded' else 'omitted' end status,coalesce(p.confirmed_at,st.omitted_at) activity_at,(p.id is null and st.full_results_seen_at is not null) locked
  from private.article_user_state st join private.articles a on a.id=st.article_id join private.article_revisions r on r.id=a.current_revision_id join private.categories c on c.id=a.category_id left join private.participations p on p.user_id=st.user_id and p.article_id=st.article_id
  where st.user_id=uid and (p.id is not null or st.omitted_at is not null) and (p_filter='all' or (p_filter='responded' and p.id is not null) or (p_filter='omitted' and p.id is null and st.omitted_at is not null)) and (coalesce(p.confirmed_at,st.omitted_at),a.id)<=(upper_time,upper_id) and (last_time is null or (coalesce(p.confirmed_at,st.omitted_at),a.id)<(last_time,last_id))
  order by coalesce(p.confirmed_at,st.omitted_at) desc,a.id desc limit 11
 ), first_ten as (select * from records order by activity_at desc,id desc limit 10)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('articleId',id,'title',title,'category',category,'status',status,'activityAt',activity_at,'locked',locked) order by activity_at desc,id desc) from first_ten),'[]'::jsonb),'hasMore',(select count(*)>10 from records),'nextCursor',case when (select count(*)>10 from records) then (select jsonb_build_object('filter',p_filter,'upperTime',upper_time,'upperId',upper_id,'lastTime',activity_at,'lastId',id) from first_ten order by activity_at asc,id asc limit 1) else null end) into result;
 return result;
end $$;

create function api.my_trends() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;account_state text;result jsonb;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;
 select account_status into account_state from private.profiles where id=uid;if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 with own as materialized (select p.id,p.choice_kind,p.confirmed_at from private.participations p join private.articles a on a.id=p.article_id where p.user_id=uid and a.status='published'),
 recent as materialized (select id,choice_kind,confirmed_at from own order by confirmed_at desc,id desc limit 20),
 denominators as (select (select count(*) from own)::integer total,(select count(*) from recent)::integer recent),
 counts as (select c.stable_key key,c.name,c.order_index,(select count(distinct o.id) from own o join private.participation_choices pc on pc.participation_id=o.id join private.opinions op on op.id=pc.opinion_id where op.character_id=c.id)::integer total_count,(select count(distinct r.id) from recent r join private.participation_choices pc on pc.participation_id=r.id join private.opinions op on op.id=pc.opinion_id where op.character_id=c.id)::integer recent_count from private.characters c where c.is_active
 union all select 'none','Ninguna',9,(select count(*)::integer from own where choice_kind='none'),(select count(*)::integer from recent where choice_kind='none')),
 mapped as (select key,name,order_index,case when d.total=0 then null else round(100*total_count::numeric/d.total,1) end total_pct,case when d.recent=0 then null else round(100*recent_count::numeric/d.recent,1) end recent_pct,case when d.total=0 or d.recent=0 then null else round(100*recent_count::numeric/d.recent-100*total_count::numeric/d.total,1) end delta from counts cross join denominators d)
 select jsonb_build_object('totalResponses',d.total,'recentResponses',d.recent,'items',(select jsonb_agg(jsonb_build_object('key',key,'name',name,'totalPercent',total_pct,'recentPercent',recent_pct,'differencePoints',delta) order by order_index) from mapped)) into result from denominators d;
 return result;
end $$;
alter function api.my_activity(text,jsonb) owner to riuya_activity_executor;
alter function api.my_trends() owner to riuya_activity_executor;
revoke create on schema api from riuya_activity_executor;
set local role riuya_activity_executor;
revoke all on function api.my_activity(text,jsonb),api.my_trends() from public,anon;
grant execute on function api.my_activity(text,jsonb),api.my_trends() to authenticated;
reset role;
