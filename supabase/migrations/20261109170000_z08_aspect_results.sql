alter table private.metric_controls add column catalog_id uuid references private.aspect_catalogs(id);
alter table private.metric_controls add constraint aspects_enabled_catalog check(metric<>'aspects' or not enabled or catalog_id is not null);
grant select on private.aspect_catalogs,private.aspect_labels,private.opinion_aspects,private.aspect_annotation_proposals to riuya_results_executor;
create policy results_aspect_catalogs on private.aspect_catalogs for select to riuya_results_executor using(true);
create policy results_aspect_labels on private.aspect_labels for select to riuya_results_executor using(true);
create policy results_opinion_aspects on private.opinion_aspects for select to riuya_results_executor using(true);
create policy results_aspect_proposals on private.aspect_annotation_proposals for select to riuya_results_executor using(true);
grant execute on function private.aspect_independent_agreement(uuid,text) to riuya_results_executor;

create function private.aspects_t07(p_article_id uuid,p_user_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with participants as materialized (
  select id,user_id from private.participations where article_id=p_article_id
 ),
 choices as materialized (
  select p.id participation_id,p.user_id,pc.opinion_id,count(*) over(partition by p.id)::numeric k
  from participants p join private.participation_choices pc on pc.participation_id=p.id
 ),
 weighted as materialized (
  select ch.participation_id,ch.user_id,oa.dimension,l.label_key,oa.weight_basis_points::numeric/10000/ch.k value
  from choices ch join private.opinion_aspects oa on oa.opinion_id=ch.opinion_id
  join private.aspect_labels l on l.id=oa.label_id
  join private.metric_controls mc on mc.metric='aspects' and mc.catalog_id=l.catalog_id and mc.enabled and mc.formula_version='T07-v1' and mc.validated_at is not null and mc.validated_by is not null
  join private.aspect_catalogs cat on cat.id=l.catalog_id and cat.status='validated'
  where private.aspect_independent_agreement(oa.opinion_id,oa.dimension)
 ),
 by_user as (select participation_id,user_id,dimension,label_key,sum(value) value from weighted group by participation_id,user_id,dimension,label_key),
 own as (select dimension,label_key,sum(value) value from by_user where user_id=p_user_id group by dimension,label_key),
 others as (select dimension,label_key,sum(value) value from by_user group by dimension,label_key),
 contributors as (select dimension,count(distinct participation_id) n from by_user group by dimension),
 dims as (select unnest(array['emotion','approach','stance']) dimension),
 parts as (
  select d.dimension,
   case when coalesce((select sum(value) from own where dimension=d.dimension),0)>0 then
    jsonb_build_object('coverage',round((select sum(value) from own where dimension=d.dimension),4),
     'items',(select jsonb_agg(jsonb_build_object('key',label_key,'percentage',round(100*value/(select sum(value) from own where dimension=d.dimension),1)) order by value desc,label_key) from own where dimension=d.dimension))
   else null end personal,
   case when (select count(*) from participants)>=10 and coalesce((select n from contributors where dimension=d.dimension),0)>=10 then
    jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('key',label_key,'percentage',round(100*value/(select sum(value) from others where dimension=d.dimension),1)) order by value desc,label_key) from others where dimension=d.dimension))
   else null end community
  from dims d
 )
 select jsonb_build_object('state','available','formulaVersion','T07-v1','dimensions',jsonb_agg(jsonb_build_object('dimension',dimension,'personal',personal,'community',community) order by dimension)) from parts
$$;
revoke all on function private.aspects_t07(uuid,uuid) from public,anon,authenticated;
grant execute on function private.aspects_t07(uuid,uuid) to riuya_results_executor;
grant create on schema private to riuya_results_executor;
set local role riuya_results_executor;
create or replace function private.access_results_impl(p_article_id uuid,p_formula_version integer) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text; a private.articles%rowtype; st private.article_user_state%rowtype; own_response boolean; n bigint; community jsonb; next_id uuid; coincidence jsonb:=null; aspect_result jsonb;
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
 if n>=10 and exists(select 1 from private.metric_controls mc where mc.metric='coincidence' and mc.enabled and mc.formula_version='T07-v1' and mc.validated_at is not null and mc.validated_by is not null) then
  coincidence:=private.coincidence_t07(a.id,uid);
 end if;
 aspect_result:=jsonb_build_object('state',case when n>=10 then 'disabled' else 'insufficient_data' end,'items','[]'::jsonb);
 if n>=10 and exists(select 1 from private.metric_controls mc join private.aspect_catalogs c on c.id=mc.catalog_id where mc.metric='aspects' and mc.enabled and mc.formula_version='T07-v1' and mc.validated_at is not null and mc.validated_by is not null and c.status='validated') then
  aspect_result:=private.aspects_t07(a.id,uid);
 end if;
 return jsonb_build_object('nextArticleId',next_id,'articleId',a.id,'formulaVersion',2,'mode',case when n>=10 then 'complete' else 'preliminary' end,'generatedAt',now(),'participationLocked',st.full_results_seen_at is not null,'community',community,'coincidence',coincidence,'aspects',aspect_result);
end $$;
reset role;
revoke create on schema private from riuya_results_executor;
