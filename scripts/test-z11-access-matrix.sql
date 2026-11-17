begin;
do $$
declare u uuid:=gen_random_uuid();s record;result jsonb;
begin
 insert into auth.users(id,email) values(u,'z11-matrix-'||u||'@example.invalid');
 insert into private.profiles(id,account_status) values(u,'deletion_pending');
 insert into private.user_roles(user_id,role) values(u,'admin');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 perform set_config('role','authenticated',true);
 for s in select * from (values
  ('my_trends','select api.my_trends()'),
  ('my_activity','select api.my_activity(''all'',null)'),
  ('notification_settings','select api.notification_settings()'),
  ('notification_history','select api.notification_history()'),
  ('update_notifications','select api.update_notification_settings(false,false,8,''UTC'',1)'),
  ('profile','select api.account_ensure_profile()'),
  ('participation_state','select api.participation_state(''11111111-1111-4111-8111-111111111111'')'),
  ('participation_limit','select api.take_participation_limit(''confirm'')'),
  ('results_limit','select api.take_results_limit()'),
  ('access_results','select api.access_results(''11111111-1111-4111-8111-111111111111'',2)'),
  ('editor_list','select api.editor_list()'),
  ('editor_catalog','select api.editor_catalog()'),
  ('editor_sources','select api.editor_sources()'),
  ('editor_fixture_jobs','select api.editor_fixture_jobs()'),
  ('editor_source_jobs','select api.editor_source_jobs()'),
  ('editor_group_proposals','select api.editor_group_proposals()'),
  ('enqueue_fixture','select api.enqueue_fixture_draft(''11111111-1111-4111-8111-111111111111'')'),
  ('cancel_job','select api.cancel_editor_job(''11111111-1111-4111-8111-111111111111'')'),
  ('aspect_proposal','select api.submit_aspect_proposal(''11111111-1111-4111-8111-111111111111'',1,''emotion'',''[]'')'),
  ('confirm','select api.confirm_participation(''11111111-1111-4111-8111-111111111111'',''11111111-1111-4111-8111-111111111111'',''11111111-1111-4111-8111-111111111111'',''none'',''{}''::uuid[])'),
  ('omit','select api.omit_article(''11111111-1111-4111-8111-111111111111'')'),
  ('editor_get','select api.editor_get(''11111111-1111-4111-8111-111111111111'')'),
  ('editor_save','select api.editor_save(''11111111-1111-4111-8111-111111111111'',1,''{}''::jsonb)'),
  ('editor_review','select api.editor_review(''11111111-1111-4111-8111-111111111111'',1)'),
  ('editor_publish','select api.editor_publish(''11111111-1111-4111-8111-111111111111'',1,''11111111-1111-4111-8111-111111111111'',''fixture'',true)'),
  ('editor_withdraw','select api.editor_withdraw(''11111111-1111-4111-8111-111111111111'',1,''fixture'')'),
  ('editor_correct','select api.editor_correct(''11111111-1111-4111-8111-111111111111'',1,''{}''::jsonb,''fixture'',true)'),
  ('source_fetch','select api.editor_fetch_source(''11111111-1111-4111-8111-111111111111'',1)'),
  ('source_active','select api.editor_set_source_active(''11111111-1111-4111-8111-111111111111'',1,false)'),
  ('source_save','select api.editor_save_source(''11111111-1111-4111-8111-111111111111'',1,''fixture'',''https://example.invalid'',''example.invalid'',''rss'',''fixture'',true)'),
  ('group_decide','select api.editor_decide_group(''11111111-1111-4111-8111-111111111111'',1,''rejected'')'),
  ('event_primary','select api.editor_set_event_primary(''11111111-1111-4111-8111-111111111111'',1,''11111111-1111-4111-8111-111111111111'',1,true)'),
  ('enqueue_ollama','select api.enqueue_ollama_draft(''11111111-1111-4111-8111-111111111111'',''11111111-1111-4111-8111-111111111111'')'),
  ('import_draft','select api.import_generated_draft(''11111111-1111-4111-8111-111111111111'',''11111111-1111-4111-8111-111111111111'',true)'),
  ('validate_catalog','select api.validate_aspect_catalog(''11111111-1111-4111-8111-111111111111'',''fixture'',true)')
 ) x(name,statement) loop
  begin
   execute s.statement into result;
   if coalesce(result->>'message','') not in ('ACCOUNT_INACTIVE','FORBIDDEN','UNAUTHENTICATED') then raise exception 'MATRIX_ACCESS_ALLOWED: % => %',s.name,result;end if;
  exception when insufficient_privilege then null;
  end;
 end loop;
 perform set_config('role','none',true);
end $$;
rollback;
