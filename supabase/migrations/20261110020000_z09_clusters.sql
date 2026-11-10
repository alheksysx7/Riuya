-- Las coincidencias son propuestas; solo un editor puede asignar acontecimientos.
alter table private.source_items add column event_id uuid references private.events(id);
create table private.source_group_proposals(
 id uuid primary key default gen_random_uuid(),item_a uuid not null references private.source_items(id),
 item_b uuid not null references private.source_items(id),status text not null default 'proposed' check(status in ('proposed','confirmed','rejected')),
 version integer not null default 1 check(version>0),decided_by uuid references private.profiles(id) on delete restrict,decided_at timestamptz,
 event_id uuid references private.events(id),created_at timestamptz not null default now(),
 unique(item_a,item_b),check(item_a<item_b),
 check((status='proposed' and decided_by is null and decided_at is null and event_id is null) or (status='rejected' and decided_by is not null and decided_at is not null and event_id is null) or (status='confirmed' and decided_by is not null and decided_at is not null and event_id is not null))
);
alter table private.source_group_proposals enable row level security;
revoke all on private.source_group_proposals from public,anon,authenticated;
grant select,insert on private.source_group_proposals to riuya_job_executor;
grant select,update on private.source_group_proposals to riuya_editor_executor;
grant update on private.source_items to riuya_editor_executor;
grant select,insert on private.events to riuya_editor_executor;
create policy worker_group_proposals on private.source_group_proposals for all to riuya_job_executor using(true) with check(true);
create policy editor_group_select on private.source_group_proposals for select to riuya_editor_executor using(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));
create policy editor_group_update on private.source_group_proposals for update to riuya_editor_executor using(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active')) with check(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));
create policy editor_source_items_update on private.source_items for update to riuya_editor_executor using(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active')) with check(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));
create policy editor_event_select on private.events for select to riuya_editor_executor using(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));
create policy editor_event_insert on private.events for insert to riuya_editor_executor with check(exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and r.role in ('editor','admin') and p.account_status='active'));

grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create function private.cluster_job_info(p_job uuid,p_token uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.jobs where id=p_job and status='running' and job_type='event.cluster' and lease_token=p_token and lease_until>now()) then return null;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'date',x.external_date) order by x.ingested_at desc) from (select id,title,external_date,ingested_at from private.source_items order by ingested_at desc,id desc limit 100) x),'[]'::jsonb);
end $$;
create function private.complete_cluster_job(p_job uuid,p_token uuid,p_pairs jsonb) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;x jsonb;a uuid;b uuid;
begin
 select * into j from private.jobs where id=p_job and status='running' and job_type='event.cluster' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 if jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_array_length(p_pairs)>200 or length(p_pairs::text)>30000 then raise exception 'INVALID_PAIRS' using errcode='22023';end if;
 for x in select * from jsonb_array_elements(p_pairs) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['a','b']) or (select count(*) from jsonb_object_keys(x))<>2 then raise exception 'INVALID_PAIRS' using errcode='22023';end if;
  a:=(x->>'a')::uuid;b:=(x->>'b')::uuid;if a=b then raise exception 'INVALID_PAIRS' using errcode='22023';end if;
  insert into private.source_group_proposals(item_a,item_b) values(least(a,b),greatest(a,b)) on conflict(item_a,item_b) do nothing;
 end loop;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function private.cluster_job_info(uuid,uuid),private.complete_cluster_job(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.cluster_job_info(uuid,uuid),private.complete_cluster_job(uuid,uuid,jsonb) to riuya_worker_client;
reset role;
revoke create on schema private from riuya_job_executor;

grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create function api.editor_group_proposals() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;result jsonb;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'status',x.status,'version',x.version,'titleA',x.title_a,'titleB',x.title_b,'eventId',x.event_id) order by x.created_at desc),'[]'::jsonb) into result
 from (select g.*,a.title title_a,b.title title_b from private.source_group_proposals g join private.source_items a on a.id=g.item_a join private.source_items b on b.id=g.item_b order by g.created_at desc limit 50) x;
 return result;
end $$;
create function api.editor_decide_group(p_id uuid,p_version integer,p_decision text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;g private.source_group_proposals%rowtype;a private.source_items%rowtype;b private.source_items%rowtype;eid uuid;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('confirm','reject') then raise exception 'INVALID_DECISION' using errcode='22023';end if;
 select * into g from private.source_group_proposals where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if g.status<>'proposed' or g.version is distinct from p_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if p_decision='confirm' then
  select * into a from private.source_items where id=g.item_a for update;
  select * into b from private.source_items where id=g.item_b for update;
  if a.event_id is not null and b.event_id is not null and a.event_id<>b.event_id then raise exception 'EVENT_CONFLICT' using errcode='PT409';end if;
  eid:=coalesce(a.event_id,b.event_id);
  if eid is null then insert into private.events(title) values(a.title) returning id into eid;end if;
  update private.source_items set event_id=eid where id in (a.id,b.id);
 end if;
 update private.source_group_proposals set status=case when p_decision='confirm' then 'confirmed' else 'rejected' end,event_id=eid,decided_by=uid,decided_at=now(),version=version+1 where id=g.id;
 return jsonb_build_object('id',g.id,'status',case when p_decision='confirm' then 'confirmed' else 'rejected' end,'eventId',eid);
end $$;
revoke all on function api.editor_group_proposals(),api.editor_decide_group(uuid,integer,text) from public,anon;
grant execute on function api.editor_group_proposals(),api.editor_decide_group(uuid,integer,text) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;

