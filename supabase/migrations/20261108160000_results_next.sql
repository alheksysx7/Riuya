grant create on schema private to riuya_results_executor;
set local role riuya_results_executor;
create or replace function private.access_results_impl(p_article_id uuid,p_formula_version integer) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text; a private.articles%rowtype; st private.article_user_state%rowtype; own_response boolean; n bigint; community jsonb; next_id uuid;
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
 select x.id into next_id from private.articles x where x.status='published' and (x.published_at,x.id)<(a.published_at,a.id) order by x.published_at desc,x.id desc limit 1;
 return jsonb_build_object('nextArticleId',next_id,'articleId',a.id,'formulaVersion',2,'mode',case when n>=10 then 'complete' else 'preliminary' end,'generatedAt',now(),'participationLocked',st.full_results_seen_at is not null,'community',community,'coincidence',null,'aspects',jsonb_build_object('state',case when n>=10 then 'disabled' else 'insufficient_data' end,'items','[]'::jsonb));
end $$;
reset role;
revoke create on schema private from riuya_results_executor;
