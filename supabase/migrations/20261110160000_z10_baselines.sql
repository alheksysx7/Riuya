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
   update private.notification_deliveries set status='cancelled' where user_id=uid and status='queued';
   update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=now() where job_type='notification.send' and created_by=uid and status in ('queued','running') and payload->>'deliveryId' in (select id::text from private.notification_deliveries where user_id=uid and status='cancelled');
  end if;
  update private.notification_preferences set news_opt_in=p_news,results_opt_in=p_results,hour_local=p_hour,timezone=p_timezone,
   news_enabled_at=case when p_news and not v.news_opt_in then now() when not p_news then null else v.news_enabled_at end,
   results_enabled_at=case when p_results and not v.results_opt_in then now() when not p_results then null else v.results_enabled_at end,
   schedule_changed_at=case when v.hour_local<>p_hour or v.timezone<>p_timezone or v.news_opt_in<>p_news or v.results_opt_in<>p_results then now() else v.schedule_changed_at end,
   news_seen_at=case when not p_news then null when not v.news_opt_in or v.hour_local<>p_hour or v.timezone<>p_timezone then now() else v.news_seen_at end,
   results_snapshot=case when not p_results then '{}'::jsonb when not v.results_opt_in or v.hour_local<>p_hour or v.timezone<>p_timezone then private.notification_result_snapshot(uid) else v.results_snapshot end,
   version=version+1,updated_at=now() where user_id=uid returning * into v;
 end if;
 return jsonb_build_object('newsOptIn',v.news_opt_in,'resultsOptIn',v.results_opt_in,'hour',v.hour_local,'timezone',v.timezone,'version',v.version);
end $$;
create function api.notification_history() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;result jsonb;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;
 if not exists(select 1 from private.profiles where id=uid and account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'channel',x.channel,'localDate',x.local_date,'timezone',x.timezone,'status',x.status,'sentAt',x.sent_at) order by x.created_at desc),'[]'::jsonb) into result from (select * from private.notification_deliveries where user_id=uid order by created_at desc,id desc limit 20) x;
 return result;
end $$;
revoke all on function api.notification_history() from public,anon;
grant execute on function api.notification_history() to authenticated;
reset role;
revoke create on schema api from riuya_notification_user;
