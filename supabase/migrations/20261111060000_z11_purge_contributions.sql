-- Eliminación reanudable de contribuciones. No está expuesta al worker.
grant select, delete on private.participations,private.article_user_state,
 private.notification_preferences,private.notification_deliveries,private.participation_rate_buckets to riuya_purge_executor;
create policy purge_participations_read on private.participations for select to riuya_purge_executor using (true);
create policy purge_participations_delete on private.participations for delete to riuya_purge_executor using (true);
create policy purge_state_read on private.article_user_state for select to riuya_purge_executor using (true);
create policy purge_state_delete on private.article_user_state for delete to riuya_purge_executor using (true);
create policy purge_preferences_read on private.notification_preferences for select to riuya_purge_executor using (true);
create policy purge_preferences_delete on private.notification_preferences for delete to riuya_purge_executor using (true);
create policy purge_deliveries_read on private.notification_deliveries for select to riuya_purge_executor using (true);
create policy purge_deliveries_delete on private.notification_deliveries for delete to riuya_purge_executor using (true);
create policy purge_rates_read on private.participation_rate_buckets for select to riuya_purge_executor using (true);
create policy purge_rates_delete on private.participation_rate_buckets for delete to riuya_purge_executor using (true);

grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
create function private.purge_account_contributions(p_job uuid,p_token uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare state jsonb; uid uuid; rid uuid;
begin
 -- La función inicial bloquea perfil, solicitud y trabajo y comprueba plazo y lease.
 state:=private.begin_account_purge(p_job,p_token);
 uid:=(state->>'userId')::uuid;
 if state->>'stage'='contributions_removed' then return 'contributions_removed'; end if;
 if state->>'stage'<>'started' then raise exception 'PURGE_STATE_INVALID'; end if;
 select request_id into rid from private.account_purge_operations where job_id=p_job and user_id=uid for update;
 if not found then raise exception 'PURGE_STATE_INVALID'; end if;
 delete from private.participations where user_id=uid;
 delete from private.article_user_state where user_id=uid;
 delete from private.notification_deliveries where user_id=uid;
 delete from private.notification_preferences where user_id=uid;
 delete from private.participation_rate_buckets where user_id=uid;
 update private.account_purge_operations set stage='contributions_removed',updated_at=clock_timestamp() where request_id=rid;
 return 'contributions_removed';
end $$;
revoke all on function private.purge_account_contributions(uuid,uuid) from public,anon,authenticated;
reset role;
revoke create on schema private from riuya_purge_executor;
