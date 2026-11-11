-- Primera ocurrencia en repetición; siguiente minuto local válido en un salto.
create function private.notification_due_at(p_day date,p_hour integer,p_zone text) returns timestamptz
language sql stable set search_path='' as $$
 with base as (
  select p_day::timestamp+make_interval(hours=>p_hour) target,
         (p_day::timestamp+make_interval(hours=>p_hour)) at time zone p_zone anchor
 ), offsets as (
  select distinct (probe at time zone p_zone)-(probe at time zone 'UTC') delta
  from base cross join lateral (values(anchor-interval '36 hours'),(anchor),(anchor+interval '36 hours')) v(probe)
 ), candidates as (
  select n,((target+make_interval(mins=>n)-delta) at time zone 'UTC') instant,target+make_interval(mins=>n) local_time
  from base cross join offsets cross join generate_series(0,180) n
 )
 select instant from candidates where local_time::date=p_day and instant at time zone p_zone=local_time order by n,instant limit 1
$$;
revoke all on function private.notification_due_at(date,integer,text) from public,anon,authenticated;
