-- Preferencias separadas de Auth; sin consentimiento no se programa ninguna entrega.
create table private.notification_preferences(
 user_id uuid primary key references private.profiles(id) on delete cascade,
 news_opt_in boolean not null default false,results_opt_in boolean not null default false,
 hour_local integer not null default 8 check(hour_local in (8,12,19)),
 timezone text not null default 'UTC',version integer not null default 1 check(version>0),
 schedule_changed_at timestamptz not null default now(),
 news_enabled_at timestamptz,results_enabled_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((not news_opt_in) or news_enabled_at is not null),
 check((not results_opt_in) or results_enabled_at is not null)
);
alter table private.notification_preferences enable row level security;
revoke all on private.notification_preferences from public,anon,authenticated;
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_notification_user') then create role riuya_notification_user nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;end if;end $$;
grant riuya_notification_user to postgres with inherit false;
grant usage on schema private to riuya_notification_user;
grant select,update on private.profiles to riuya_notification_user;
grant select,insert,update on private.notification_preferences to riuya_notification_user;
create policy notification_own_profile on private.profiles for select to riuya_notification_user using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy notification_own_profile_lock on private.profiles for update to riuya_notification_user using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(false);
create policy notification_own_prefs on private.notification_preferences for all to riuya_notification_user using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);

grant usage,create on schema api to riuya_notification_user;
set local role riuya_notification_user;
create function api.notification_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;v private.notification_preferences%rowtype;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;
 if not exists(select 1 from private.profiles where id=uid and account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into v from private.notification_preferences where user_id=uid;
 if not found then return jsonb_build_object('newsOptIn',false,'resultsOptIn',false,'hour',8,'timezone','UTC','version',0);end if;
 return jsonb_build_object('newsOptIn',v.news_opt_in,'resultsOptIn',v.results_opt_in,'hour',v.hour_local,'timezone',v.timezone,'version',v.version);
end $$;
create function api.update_notification_settings(p_news boolean,p_results boolean,p_hour integer,p_timezone text,p_expected_version integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;v private.notification_preferences%rowtype;state text;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401';end if;
 select account_status into state from private.profiles where id=uid for update;if state is distinct from 'active' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_news is null or p_results is null or p_hour is null or p_hour not in (8,12,19) or p_timezone is null or length(p_timezone)>100 or (p_timezone<>'UTC' and position('/' in p_timezone)=0) or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'INVALID_SETTINGS' using errcode='22023';end if;
 select * into v from private.notification_preferences where user_id=uid for update;
 if not found then
  if p_expected_version is distinct from 0 then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
  insert into private.notification_preferences(user_id,news_opt_in,results_opt_in,hour_local,timezone,news_enabled_at,results_enabled_at) values(uid,p_news,p_results,p_hour,p_timezone,case when p_news then now() end,case when p_results then now() end) returning * into v;
 else
  if v.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
  update private.notification_preferences set news_opt_in=p_news,results_opt_in=p_results,hour_local=p_hour,timezone=p_timezone,
   news_enabled_at=case when p_news and not v.news_opt_in then now() when not p_news then null else v.news_enabled_at end,
   results_enabled_at=case when p_results and not v.results_opt_in then now() when not p_results then null else v.results_enabled_at end,
   schedule_changed_at=case when v.hour_local<>p_hour or v.timezone<>p_timezone or v.news_opt_in<>p_news or v.results_opt_in<>p_results then now() else v.schedule_changed_at end,
   version=version+1,updated_at=now() where user_id=uid returning * into v;
 end if;
 return jsonb_build_object('newsOptIn',v.news_opt_in,'resultsOptIn',v.results_opt_in,'hour',v.hour_local,'timezone',v.timezone,'version',v.version);
end $$;
revoke all on function api.notification_settings(),api.update_notification_settings(boolean,boolean,integer,text,integer) from public,anon;
grant execute on function api.notification_settings(),api.update_notification_settings(boolean,boolean,integer,text,integer) to authenticated;
reset role;
revoke create on schema api from riuya_notification_user;
