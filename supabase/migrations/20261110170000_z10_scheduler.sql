grant create on schema private to riuya_notification_worker;
set local role riuya_notification_worker;
-- Migraciones de estados previos sin enviar novedades antiguas.
update private.notification_preferences set news_seen_at=coalesce(news_seen_at,news_enabled_at) where news_opt_in;
update private.notification_preferences set results_snapshot=private.notification_result_snapshot(user_id) where results_opt_in and results_snapshot='{}'::jsonb;

create function private.notification_has_results_change(p_current jsonb,p_previous jsonb) returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from jsonb_each(p_current) x where x.value is distinct from p_previous->x.key)
$$;
create function private.schedule_notifications_at(p_at timestamptz) returns integer language plpgsql volatile security definer set search_path='' as $$
declare x record;p private.notification_preferences%rowtype;state text;day_local date;due timestamptz;ch text;last_sent timestamptz;fresh boolean;snapshot jsonb;delivery uuid;created integer:=0;
begin
 for x in select user_id from private.notification_preferences where news_opt_in or results_opt_in order by user_id loop
  select account_status into state from private.profiles where id=x.user_id for update;
  if state is distinct from 'active' then continue;end if;
  select * into p from private.notification_preferences where user_id=x.user_id for update;
  if not found then continue;end if;
  day_local:=(p_at at time zone p.timezone)::date;
  due:=private.notification_due_at(day_local,p.hour_local,p.timezone);
  if due is null or p_at<due or p_at>=due+interval '1 minute' or p.schedule_changed_at>due then continue;end if;
  foreach ch in array array['news','results'] loop
   if (ch='news' and not p.news_opt_in) or (ch='results' and not p.results_opt_in) then continue;end if;
   if exists(select 1 from private.notification_deliveries d where d.user_id=p.user_id and d.channel=ch and (d.local_date=day_local or d.status='queued')) then continue;end if;
   select max(d.sent_at) into last_sent from private.notification_deliveries d where d.user_id=p.user_id and d.channel=ch and d.status='sent';
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

create function private.schedule_notifications() returns integer language sql volatile security definer set search_path='' as $$
 select private.schedule_notifications_at(now())
$$;

create function private.complete_notification_at(p_job uuid,p_token uuid,p_at timestamptz) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;d private.notification_deliveries%rowtype;p private.notification_preferences%rowtype;state text;snapshot jsonb;fresh boolean;
begin
 select * into j from private.jobs where id=p_job and job_type='notification.send' and status='running' and lease_token=p_token and lease_until>now();
 if not found then return false;end if;
 select * into d from private.notification_deliveries where id=(j.payload->>'deliveryId')::uuid;
 if not found then return false;end if;
 select account_status into state from private.profiles where id=d.user_id for update;
 select * into p from private.notification_preferences where user_id=d.user_id for update;
 select * into d from private.notification_deliveries where id=d.id for update;
 select * into j from private.jobs where id=p_job and job_type='notification.send' and status='running' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 if state is distinct from 'active' or d.status<>'queued' or p.user_id is null or (d.channel='news' and not p.news_opt_in) or (d.channel='results' and not p.results_opt_in) or p.timezone<>d.timezone or (p_at at time zone p.timezone)::date<>d.local_date then
  update private.notification_deliveries set status='cancelled' where id=d.id and status='queued';
  update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
  return true;
 end if;
 if d.channel='news' then
  select exists(select 1 from private.articles a where a.status='published' and a.published_at>p.news_seen_at and a.published_at<=p_at) into fresh;
 else
  snapshot:=private.notification_result_snapshot(p.user_id);fresh:=private.notification_has_results_change(snapshot,p.results_snapshot);
 end if;
 if not coalesce(fresh,false) then
  update private.notification_deliveries set status='cancelled' where id=d.id;
  update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
  return true;
 end if;
 update private.notification_deliveries set status='sent',sent_at=p_at where id=d.id;
 if d.channel='news' then update private.notification_preferences set news_seen_at=p_at where user_id=p.user_id;
 else update private.notification_preferences set results_snapshot=snapshot where user_id=p.user_id;end if;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
create function private.complete_local_notification(p_job uuid,p_token uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select private.complete_notification_at(p_job,p_token,now())
$$;
revoke all on function private.notification_has_results_change(jsonb,jsonb),private.schedule_notifications_at(timestamptz),private.schedule_notifications(),private.complete_notification_at(uuid,uuid,timestamptz),private.complete_local_notification(uuid,uuid) from public,anon,authenticated;
grant execute on function private.schedule_notifications(),private.complete_local_notification(uuid,uuid) to riuya_worker_client;
reset role;
revoke create on schema private from riuya_notification_worker;
