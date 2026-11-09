-- Z06: resultados autorizados y bloqueo transaccional de omisiones.
alter table private.participation_rate_buckets drop constraint participation_rate_buckets_action_check;
alter table private.participation_rate_buckets add constraint participation_rate_buckets_action_check check(action in ('confirm','omit','http_confirm','http_omit','results','http_results'));
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_results_executor') then create role riuya_results_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;
grant riuya_results_executor to postgres with inherit false;
grant usage on schema private to riuya_results_executor;
grant select,update on private.profiles,private.articles,private.article_user_state to riuya_results_executor;
grant select on private.participations,private.participation_choices,private.opinions,private.characters to riuya_results_executor;
grant select,insert,update,delete on private.participation_rate_buckets to riuya_results_executor;
grant execute on function private.participation_rate_limit(uuid,text) to riuya_results_executor;
create policy results_profile on private.profiles for select to riuya_results_executor using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy results_profile_lock on private.profiles for update to riuya_results_executor using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(false);
create policy results_articles on private.articles for select to riuya_results_executor using(status='published');
create policy results_articles_lock on private.articles for update to riuya_results_executor using(status='published') with check(false);
create policy results_state on private.article_user_state for all to riuya_results_executor using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy results_participations on private.participations for select to riuya_results_executor using(true);
create policy results_choices on private.participation_choices for select to riuya_results_executor using(true);
create policy results_opinions on private.opinions for select to riuya_results_executor using(true);
create policy results_characters on private.characters for select to riuya_results_executor using(is_active);
create policy results_rate on private.participation_rate_buckets for all to riuya_results_executor using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
grant create on schema private to riuya_results_executor;
create function private.access_results_impl(p_article_id uuid,p_formula_version integer) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text; a private.articles%rowtype; st private.article_user_state%rowtype; own_response boolean; n bigint; community jsonb;
begin
 if p_formula_version is distinct from 2 then raise exception 'INVALID_FORMULA' using errcode='22023';end if;
 select account_status into account_state from private.profiles where id=uid for share;if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 select * into a from private.articles where id=p_article_id for share;if not found then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 select * into st from private.article_user_state where user_id=uid and article_id=a.id for update;
 if not found then raise exception 'RESULTS_NOT_AUTHORIZED' using errcode='PT403';end if;
 select exists(select 1 from private.participations where user_id=uid and article_id=a.id) into own_response;
 if not own_response and st.omitted_at is null then raise exception 'RESULTS_NOT_AUTHORIZED' using errcode='PT403';end if;
 -- Una sola sentencia e instantánea para N y todos los apoyos; las elecciones de cada persona nunca salen de SQL.
 with participants as materialized (select id,choice_kind from private.participations where article_id=a.id),
 totals as (select count(*)::bigint n,count(*) filter(where choice_kind='none')::bigint none_n from participants),
 voice_counts as (select o.character_id,count(distinct p.id)::bigint amount from participants p join private.participation_choices pc on pc.participation_id=p.id join private.opinions o on o.id=pc.opinion_id group by o.character_id),
 rows as (select c.stable_key key,c.name,c.order_index,coalesce(v.amount,0)::bigint amount from private.characters c left join voice_counts v on v.character_id=c.id where c.is_active)
 select t.n,case when t.n>=10 then jsonb_build_object('participants',t.n,'support',(select jsonb_agg(jsonb_build_object('key',key,'name',name,'percentage',round(100*amount::numeric/t.n,1)) order by order_index) from rows)||jsonb_build_array(jsonb_build_object('key','none','name','Ninguna','percentage',round(100*t.none_n::numeric/t.n,1)))) else null end into n,community from totals t;
 if n>=10 and not own_response and st.full_results_seen_at is null then update private.article_user_state set full_results_seen_at=now(),updated_at=now() where user_id=uid and article_id=a.id returning * into st;end if;
 return jsonb_build_object('articleId',a.id,'formulaVersion',2,'mode',case when n>=10 then 'complete' else 'preliminary' end,'generatedAt',now(),'participationLocked',st.full_results_seen_at is not null,'community',community,'coincidence',null,'aspects',jsonb_build_object('state',case when n>=10 then 'disabled' else 'insufficient_data' end,'items','[]'::jsonb));
end $$;
alter function private.access_results_impl(uuid,integer) owner to riuya_results_executor;
revoke create on schema private from riuya_results_executor;
grant usage,create on schema api to riuya_results_executor;
create function api.access_results(p_article_id uuid,p_formula_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text;msg text;sql_state text;http_status text;
begin
 perform set_config('response.status','200',true);perform set_config('response.headers','[]',true);
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;
 select account_status into account_state from private.profiles where id=uid for share;if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 if not private.participation_rate_limit(uid,'results') then perform set_config('response.status','429',true);perform set_config('response.headers','[{"Retry-After":"60"}]',true);return jsonb_build_object('code','PT429','message','RATE_LIMITED');end if;
 begin return private.access_results_impl(p_article_id,p_formula_version);
 exception when others then get stacked diagnostics msg=MESSAGE_TEXT,sql_state=RETURNED_SQLSTATE;http_status:=case when sql_state='PT404' then '404' when sql_state in ('PT403','42501') then '403' when sql_state in ('22023','22P02') then '400' else null end;if http_status is null then raise;end if;perform set_config('response.status',http_status,true);return jsonb_build_object('code',sql_state,'message',msg);end;
end $$;
create function api.take_results_limit() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text;allowed boolean;wait_seconds integer;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;select account_status into account_state from private.profiles where id=uid for share;if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501';end if;
 allowed:=private.participation_rate_limit(uid,'http_results');wait_seconds:=greatest(1,ceil(extract(epoch from date_trunc('minute',statement_timestamp())+interval '1 minute'-statement_timestamp()))::integer);return jsonb_build_object('allowed',allowed,'retryAfter',wait_seconds);
end $$;
alter function api.access_results(uuid,integer) owner to riuya_results_executor;
alter function api.take_results_limit() owner to riuya_results_executor;
revoke create on schema api from riuya_results_executor;
set local role riuya_results_executor;
revoke all on function private.access_results_impl(uuid,integer) from public,anon,authenticated;
revoke all on function api.access_results(uuid,integer),api.take_results_limit() from public,anon;
grant execute on function api.access_results(uuid,integer),api.take_results_limit() to authenticated;
reset role;

