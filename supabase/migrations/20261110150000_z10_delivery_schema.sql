-- Entregas locales, con una clave por cuenta/canal/fecha local.
alter table private.jobs drop constraint jobs_job_type_check;
alter table private.jobs add constraint jobs_job_type_check check(job_type in ('source.fetch','event.cluster','draft.generate','notification.send'));
alter table private.notification_preferences add column news_seen_at timestamptz;
alter table private.notification_preferences add column results_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(results_snapshot)='object');
create table private.notification_deliveries(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references private.profiles(id) on delete cascade,
 channel text not null check(channel in ('news','results')),local_date date not null,timezone text not null,
 scheduled_at timestamptz not null,status text not null default 'queued' check(status in ('queued','sent','cancelled')),
 sent_at timestamptz,created_at timestamptz not null default now(),unique(user_id,channel,local_date),
 check((status='sent' and sent_at is not null) or (status<>'sent' and sent_at is null))
);
create index notification_deliveries_last_sent on private.notification_deliveries(user_id,channel,sent_at desc) where status='sent';
alter table private.notification_deliveries enable row level security;
revoke all on private.notification_deliveries from public,anon,authenticated;
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_notification_worker') then create role riuya_notification_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;end if;end $$;
grant riuya_notification_worker to postgres with inherit false;
grant usage on schema private to riuya_notification_worker;
grant select,update on private.profiles,private.notification_preferences,private.notification_deliveries,private.jobs to riuya_notification_worker;
grant insert on private.notification_deliveries,private.jobs to riuya_notification_worker;
grant select on private.articles,private.article_user_state,private.participations to riuya_notification_worker;
create policy notification_worker_profiles on private.profiles for select to riuya_notification_worker using(true);
create policy notification_worker_profiles_lock on private.profiles for update to riuya_notification_worker using(true) with check(false);
create policy notification_worker_prefs on private.notification_preferences for all to riuya_notification_worker using(true) with check(true);
create policy notification_worker_deliveries on private.notification_deliveries for all to riuya_notification_worker using(true) with check(true);
create policy notification_worker_jobs on private.jobs for all to riuya_notification_worker using(job_type='notification.send') with check(job_type='notification.send');
create policy notification_worker_articles on private.articles for select to riuya_notification_worker using(status='published');
create policy notification_worker_states on private.article_user_state for select to riuya_notification_worker using(true);
create policy notification_worker_participations on private.participations for select to riuya_notification_worker using(true);
grant execute on function private.notification_due_at(date,integer,text) to riuya_notification_worker;

grant select,update on private.notification_deliveries to riuya_notification_user;
grant select,update on private.jobs to riuya_notification_user;
create policy notification_user_deliveries on private.notification_deliveries for all to riuya_notification_user using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy notification_user_jobs on private.jobs for all to riuya_notification_user using(job_type='notification.send' and created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(job_type='notification.send' and created_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);

grant create on schema private to riuya_notification_worker;
set local role riuya_notification_worker;
create function private.notification_result_snapshot(p_uid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(a.id::text,jsonb_build_object('revision',a.current_revision_id,'participants',n.total)),'{}'::jsonb)
 from private.articles a join private.article_user_state st on st.article_id=a.id and st.user_id=p_uid
 cross join lateral (select count(*)::integer total from private.participations p where p.article_id=a.id) n
 where a.status='published' and n.total>=10 and (st.omitted_at is not null or exists(select 1 from private.participations own where own.article_id=a.id and own.user_id=p_uid))
$$;
revoke all on function private.notification_result_snapshot(uuid) from public,anon,authenticated;
grant execute on function private.notification_result_snapshot(uuid) to riuya_notification_user;
reset role;
revoke create on schema private from riuya_notification_worker;
