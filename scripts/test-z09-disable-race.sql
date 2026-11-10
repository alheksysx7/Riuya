begin;
do $$
declare u uuid:=gen_random_uuid();sid uuid;jid uuid;job jsonb;result jsonb;
begin
 insert into auth.users(id,email) values(u,'z09-'||u||'@example.invalid');insert into private.profiles(id) values(u);insert into private.user_roles(user_id,role) values(u,'editor');
 perform set_config('request.jwt.claim.sub',u::text,true);
 result:=api.editor_save_source(null,null,'Fixture','https://example.org/feed','example.org','rss','Prueba local',true);sid:=(result->>'id')::uuid;
 result:=api.editor_fetch_source(sid,1);jid:=(result->>'id')::uuid;
 perform set_config('role','riuya_job_executor',true);job:=private.claim_job('disable-race',60);if job->>'id'<>jid::text then raise exception 'CLAIM_FAILED';end if;
 if private.source_job_info(jid,(job->>'leaseToken')::uuid) is null then raise exception 'SOURCE_NOT_FOUND';end if;
 perform set_config('role','none',true);perform api.editor_set_source_active(sid,1,false);
 perform set_config('role','riuya_job_executor',true);
 if private.complete_source_job(jid,(job->>'leaseToken')::uuid,'[{"url":"https://example.org/a","title":"Prueba","date":"2026-11-09T12:00:00Z"}]',null,null) then raise exception 'DISABLED_SOURCE_COMPLETED';end if;
 if exists(select 1 from private.source_items where source_id=sid) then raise exception 'DISABLED_SOURCE_SAVED';end if;
 perform set_config('role','none',true);
end $$;
rollback;
