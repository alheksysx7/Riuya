alter table private.notification_preferences add column news_changed_at timestamptz not null default now();
alter table private.notification_preferences add column results_changed_at timestamptz not null default now();
update private.notification_preferences set news_changed_at=schedule_changed_at,results_changed_at=schedule_changed_at;
grant create on schema api to riuya_notification_user;
set local role riuya_notification_user;
create or replace function api.update_notification_settings(p_news boolean,p_results boolean,p_hour integer,p_timezone text,p_expected_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;v private.notification_preferences%rowtype;state text;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;
 select account_status into state from private.profiles where id=uid for update;if state is distinct from 'active' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_news is null or p_results is null or p_hour is null or p_hour not in (8,12,19) or p_timezone is null or length(p_timezone)>100 or (p_timezone<>'UTC' and position('/' in p_timezone)=0) or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'INVALID_SETTINGS' using errcode='22023';end if;
 select * into v from private.notification_preferences where user_id=uid for update;
 if not found then
  if p_expected_version is distinct from 0 then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
  insert into private.notification_preferences(user_id,news_opt_in,results_opt_in,hour_local,timezone,news_enabled_at,results_enabled_at,news_seen_at,results_snapshot) values(uid,p_news,p_results,p_hour,p_timezone,case when p_news then now() end,case when p_results then now() end,case when p_news then now() end,case when p_results then private.notification_result_snapshot(uid) else '{}'::jsonb end) returning * into v;
 else
  if v.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
  if v.hour_local<>p_hour or v.timezone<>p_timezone or v.news_opt_in<>p_news or v.results_opt_in<>p_results then
   update private.notification_deliveries set status='cancelled' where user_id=uid and status='queued' and
    (v.hour_local<>p_hour or v.timezone<>p_timezone or (channel='news' and v.news_opt_in<>p_news) or (channel='results' and v.results_opt_in<>p_results));
   update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where job_type='notification.send' and created_by=uid and status in ('queued','running') and payload->>'deliveryId' in (select id::text from private.notification_deliveries where user_id=uid and status='cancelled');
  end if;
  update private.notification_preferences set news_opt_in=p_news,results_opt_in=p_results,hour_local=p_hour,timezone=p_timezone,
   news_enabled_at=case when p_news and not v.news_opt_in then now() when not p_news then null else v.news_enabled_at end,
   results_enabled_at=case when p_results and not v.results_opt_in then now() when not p_results then null else v.results_enabled_at end,
   schedule_changed_at=case when v.hour_local<>p_hour or v.timezone<>p_timezone or v.news_opt_in<>p_news or v.results_opt_in<>p_results then now() else v.schedule_changed_at end,
   news_changed_at=case when v.hour_local<>p_hour or v.timezone<>p_timezone or v.news_opt_in<>p_news then now() else v.news_changed_at end,
   results_changed_at=case when v.hour_local<>p_hour or v.timezone<>p_timezone or v.results_opt_in<>p_results then now() else v.results_changed_at end,
   news_seen_at=case when not p_news then null when not v.news_opt_in or v.hour_local<>p_hour or v.timezone<>p_timezone then now() else v.news_seen_at end,
   results_snapshot=case when not p_results then '{}'::jsonb when not v.results_opt_in or v.hour_local<>p_hour or v.timezone<>p_timezone then private.notification_result_snapshot(uid) else v.results_snapshot end,
   version=version+1,updated_at=now() where user_id=uid returning * into v;
 end if;
 return jsonb_build_object('newsOptIn',v.news_opt_in,'resultsOptIn',v.results_opt_in,'hour',v.hour_local,'timezone',v.timezone,'version',v.version);
end $$;
reset role;
revoke create on schema api from riuya_notification_user;
grant create on schema private to riuya_notification_worker;
set local role riuya_notification_worker;
create or replace function private.schedule_notification_user_at(p_uid uuid,p_at timestamptz) returns integer language plpgsql volatile security definer set search_path='' as $$
declare x record;p private.notification_preferences%rowtype;state text;day_local date;due timestamptz;ch text;last_sent timestamptz;fresh boolean;snapshot jsonb;delivery uuid;created integer:=0;
begin
 for x in select user_id from private.notification_preferences where user_id=p_uid and (news_opt_in or results_opt_in) order by user_id loop
  select account_status into state from private.profiles where id=x.user_id for update;
  if state is distinct from 'active' then continue;end if;
  select * into p from private.notification_preferences where user_id=x.user_id for update;
  if not found then continue;end if;
  day_local:=(p_at at time zone p.timezone)::date;
  due:=private.notification_due_at(day_local,p.hour_local,p.timezone);
  if due is null or p_at<due or p_at>=due+interval '1 minute' then continue;end if;
  foreach ch in array array['news','results'] loop
   if (ch='news' and (not p.news_opt_in or p.news_changed_at>due)) or (ch='results' and (not p.results_opt_in or p.results_changed_at>due)) then continue;end if;
   if exists(select 1 from private.notification_deliveries d where d.user_id=p.user_id and d.channel=ch and not d.is_example and (d.local_date=day_local or d.status='queued')) then continue;end if;
   select max(d.sent_at) into last_sent from private.notification_deliveries d where d.user_id=p.user_id and d.channel=ch and d.status='sent' and not d.is_example;
   if last_sent is not null and p_at<last_sent+interval '20 hours' then continue;end if;
   if ch='news' then
    select exists(select 1 from private.articles a where a.status='published' and a.published_at>p.news_seen_at and a.published_at<=p_at) into fresh;
   else
    snapshot:=private.notification_result_snapshot(p.user_id);
    fresh:=private.notification_has_results_change(snapshot,p.results_snapshot);
   end if;
   if not coalesce(fresh,false) then continue;end if;
   insert into private.notification_deliveries(user_id,channel,local_date,timezone,scheduled_at) values(p.user_id,ch,day_local,p.timezone,due) on conflict(user_id,channel,local_date) do nothing returning id into delivery;
   if delivery is not null then
    insert into private.jobs(job_type,payload,dedupe_key,created_by) values('notification.send',jsonb_build_object('deliveryId',delivery),'notification:'||delivery,p.user_id);
    created:=created+1;
   end if;
   delivery:=null;
  end loop;
 end loop;
 return created;
end $$;

reset role;
revoke create on schema private from riuya_notification_worker;
