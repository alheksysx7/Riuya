begin;
do $$
begin
 if private.notification_due_at('2026-03-08',2,'America/New_York') is distinct from '2026-03-08 07:00:00+00'::timestamptz then raise exception 'SPRING_GAP';end if;
 if private.notification_due_at('2026-11-01',1,'America/New_York') is distinct from '2026-11-01 05:00:00+00'::timestamptz then raise exception 'FALL_FIRST';end if;
 if private.notification_due_at('2026-11-09',8,'America/Guayaquil') is distinct from '2026-11-09 13:00:00+00'::timestamptz then raise exception 'ZONE_TIME';end if;
 if private.notification_due_at('2011-12-30',8,'Pacific/Apia') is not null then raise exception 'SKIPPED_DATE';end if;
end $$;
rollback;
