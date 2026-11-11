begin;
set local role riuya_purge_executor;
grant execute on function private.purge_account_contributions(uuid,uuid) to postgres;
reset role;
insert into auth.users(id,email) select ('b11c0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'z11-contribution-'||i||'@example.invalid' from generate_series(1,11) i;
insert into private.profiles(id,account_status) select ('b11c0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,case when i=1 then 'deletion_pending' else 'active' end from generate_series(1,11) i;
insert into private.articles(id,category_id) select 'b11c0000-0000-4000-8000-000000000020',id from private.categories limit 1;
insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values('b11c0000-0000-4000-8000-000000000021','b11c0000-0000-4000-8000-000000000020',1,'Fixture Z11','Resumen','[]');
insert into private.opinions(revision_id,character_id,body) select 'b11c0000-0000-4000-8000-000000000021',id,'Prueba' from private.characters;
update private.articles set status='published',published_at=now(),current_revision_id='b11c0000-0000-4000-8000-000000000021' where id='b11c0000-0000-4000-8000-000000000020';
insert into private.participations(user_id,article_id,revision_id,choice_kind,operation_id,payload_hash)
select ('b11c0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'b11c0000-0000-4000-8000-000000000020','b11c0000-0000-4000-8000-000000000021',case when i=1 then 'voices' else 'none' end,gen_random_uuid(),repeat('a',64) from generate_series(1,10) i;
insert into private.participation_choices(participation_id,opinion_id) select p.id,o.id from private.participations p cross join lateral (select id from private.opinions where revision_id=p.revision_id limit 1) o where p.user_id='b11c0000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;
insert into private.article_user_state(user_id,article_id,omitted_at) values ('b11c0000-0000-4000-8000-000000000011','b11c0000-0000-4000-8000-000000000020',now());
insert into private.article_user_state(user_id,article_id) values ('b11c0000-0000-4000-8000-000000000001','b11c0000-0000-4000-8000-000000000020');
insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values ('b11c0000-0000-4000-8000-000000000030','b11c0000-0000-4000-8000-000000000001',now()-interval '8 days',now()-interval '1 day','pending');
insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values ('b11c0000-0000-4000-8000-000000000031','account.purge','{"requestId":"b11c0000-0000-4000-8000-000000000030"}','z11-contribution-job','b11c0000-0000-4000-8000-000000000001','running','fixture','b11c0000-0000-4000-8000-000000000032',now()+interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claim.sub','b11c0000-0000-4000-8000-000000000011',true);
do $$ declare r jsonb; begin
 r:=api.access_results('b11c0000-0000-4000-8000-000000000020',2);
 if r->>'mode'<>'complete' or (r->'community'->>'participants')::int<>10 then raise exception 'MISSING_10_FIXTURE: %',r; end if;
end $$;
reset role;
do $$ begin
 if private.purge_account_contributions('b11c0000-0000-4000-8000-000000000031','b11c0000-0000-4000-8000-000000000032')<>'contributions_removed' then raise exception 'PURGE_FAILED'; end if;
 if private.purge_account_contributions('b11c0000-0000-4000-8000-000000000031','b11c0000-0000-4000-8000-000000000032')<>'contributions_removed' then raise exception 'RETRY_FAILED'; end if;
 if (select count(*) from private.participations where article_id='b11c0000-0000-4000-8000-000000000020')<>9 or exists(select 1 from private.article_user_state where user_id='b11c0000-0000-4000-8000-000000000001') or exists(select 1 from private.participation_choices c join private.opinions o on o.id=c.opinion_id where o.revision_id='b11c0000-0000-4000-8000-000000000021') then raise exception 'PURGE_SCOPE_WRONG'; end if;
end $$;
set local role authenticated;
do $$ declare r jsonb; begin
 r:=api.access_results('b11c0000-0000-4000-8000-000000000020',2);
 if r->>'mode'<>'preliminary' or r->'community'<>'null'::jsonb or not (r->>'participationLocked')::boolean then raise exception 'NINE_OR_LOCK_WRONG: %',r; end if;
end $$;
reset role;
set constraints all immediate;
rollback;
