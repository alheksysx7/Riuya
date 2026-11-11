begin;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();v jsonb;
begin
 if has_table_privilege('authenticated','private.notification_preferences','select') or has_function_privilege('anon','api.notification_settings()','execute') then raise exception 'UNAUTHORIZED_ACCESS';end if;
 insert into auth.users(id,email) values(a,'z10-'||a||'@example.invalid'),(b,'z10-'||b||'@example.invalid');
 insert into private.profiles(id) values(a),(b);
 perform set_config('request.jwt.claim.sub',a::text,true);
 v:=api.notification_settings();if (v->>'newsOptIn')::boolean or (v->>'resultsOptIn')::boolean or (v->>'version')::integer<>0 then raise exception 'BAD_DEFAULT';end if;
 begin perform api.update_notification_settings(true,false,9,'America/Guayaquil',0);raise exception 'BAD_HOUR_ACCEPTED';exception when invalid_parameter_value then null;end;
 begin perform api.update_notification_settings(true,false,8,'UTC+05:00',0);raise exception 'BAD_ZONE_ACCEPTED';exception when invalid_parameter_value then null;end;
 v:=api.update_notification_settings(true,false,12,'America/Guayaquil',0);if not (v->>'newsOptIn')::boolean or (v->>'resultsOptIn')::boolean or (v->>'version')::integer<>1 then raise exception 'SAVE_FAILED';end if;
 begin perform api.update_notification_settings(false,false,8,'UTC',0);raise exception 'STALE_ACCEPTED';exception when sqlstate 'PT409' then null;end;
 perform set_config('request.jwt.claim.sub',b::text,true);v:=api.notification_settings();if (v->>'newsOptIn')::boolean or (v->>'version')::integer<>0 then raise exception 'CROSS_ACCOUNT_ACCESS';end if;
 update private.profiles set account_status='deletion_pending' where id=b;
 begin perform api.notification_settings();raise exception 'INACTIVE_ACCEPTED';exception when insufficient_privilege then null;end;
end $$;
rollback;
