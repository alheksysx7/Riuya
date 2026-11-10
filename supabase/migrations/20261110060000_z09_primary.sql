alter table private.events add column primary_article_id uuid references private.articles(id);
alter table private.events add column version integer not null default 1 check(version>0);
create unique index event_primary_article_unique on private.events(primary_article_id) where primary_article_id is not null;
grant update on private.events to riuya_editor_executor;
create policy editor_event_update on private.events for update to riuya_editor_executor using(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active')) with check(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));
grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create or replace function api.editor_group_proposals() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;result jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'status',x.status,'version',x.version,'titleA',x.title_a,'titleB',x.title_b,'urlA',x.url_a,'urlB',x.url_b,'dateA',x.date_a,'dateB',x.date_b,'eventId',x.event_id,'eventVersion',x.event_version,'primaryArticleId',x.primary_article_id) order by x.created_at desc),'[]'::jsonb) into result
 from (select g.*,a.title title_a,b.title title_b,a.canonical_url url_a,b.canonical_url url_b,a.external_date date_a,b.external_date date_b,e.version event_version,e.primary_article_id from private.source_group_proposals g join private.source_items a on a.id=g.item_a join private.source_items b on b.id=g.item_b left join private.events e on e.id=g.event_id order by g.created_at desc limit 50) x;
 return result;
end $$;
create function api.editor_set_event_primary(p_event_id uuid,p_event_version integer,p_article_id uuid,p_article_version integer,p_confirm boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;e private.events%rowtype;a private.articles%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'APPROVAL_REQUIRED' using errcode='22023';end if;
 select * into e from private.events where id=p_event_id for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into a from private.articles where id=p_article_id for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if e.version is distinct from p_event_version or a.version is distinct from p_article_version or a.status<>'published' or (e.primary_article_id is not null and e.primary_article_id<>a.id) or (a.event_id is not null and a.event_id<>e.id) then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if e.primary_article_id=a.id then return jsonb_build_object('eventId',e.id,'articleId',a.id);end if;
 update private.articles set event_id=e.id,version=version+1,updated_at=now() where id=a.id;
 update private.events set primary_article_id=a.id,version=version+1 where id=e.id;
 return jsonb_build_object('eventId',e.id,'articleId',a.id);
end $$;
revoke all on function api.editor_set_event_primary(uuid,integer,uuid,integer,boolean) from public,anon;
grant execute on function api.editor_set_event_primary(uuid,integer,uuid,integer,boolean) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;
