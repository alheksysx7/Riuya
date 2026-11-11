grant create on schema private to riuya_notification_worker;
set local role riuya_notification_worker;
create function private.schedule_notification_user_at(p_uid uuid,p_at timestamptz) returns integer language plpgsql volatile security definer set search_path='' as $$
declare x record;p private.notification_preferences%rowtype;state text;day_local date;due timestamptz;ch text;last_sent timestamptz;fresh boolean;snapshot jsonb;delivery uuid;created integer:=0;
begin
 for x in select user_id from private.notification_preferences where user_id=p_uid and (news_opt_in or results_opt_in) order by user_id loop
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

create or replace function private.schedule_notifications_at(p_at timestamptz) returns integer language plpgsql volatile security definer set search_path='' as $$
declare x record;total integer:=0;
begin
 for x in select user_id from private.notification_preferences where news_opt_in or results_opt_in order by user_id loop
  total:=total+private.schedule_notification_user_at(x.user_id,p_at);
 end loop;
 return total;
end $$;
revoke all on function private.schedule_notification_user_at(uuid,timestamptz) from public,anon,authenticated;
reset role;
revoke create on schema private from riuya_notification_worker;
