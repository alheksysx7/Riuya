begin;
do $$
declare aid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();oid uuid:=gen_random_uuid(); uid uuid; own uuid; pid uuid; i integer; result jsonb;
begin
 insert into private.articles(id,category_id) select aid,id from private.categories limit 1;
 insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values(rid,aid,1,'SIMULACIÓN Z08','Prueba','[]');
 update private.articles set current_revision_id=rid where id=aid;
 insert into private.opinions(id,revision_id,character_id,body) select oid,rid,id,'Opinión' from private.characters limit 1;
 for i in 1..10 loop
  uid:=gen_random_uuid();if i=1 then own:=uid;end if;
  insert into auth.users(id,email) values(uid,'z08-'||uid||'@example.invalid');
  insert into private.profiles(id) values(uid);
  pid:=gen_random_uuid();
  insert into private.participations(id,user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) values(pid,uid,aid,rid,case when i=10 then 'voices' else 'none' end,gen_random_uuid(),repeat('a',64));
  if i=10 then insert into private.participation_choices(participation_id,opinion_id) values(pid,oid);end if;
  if i=9 and private.coincidence_t07(aid,own)->>'state'<>'insufficient_data' then raise exception 'NINE_THRESHOLD';end if;
 end loop;
 result:=private.coincidence_t07(aid,own);
 if result->>'state'<>'available' or (result->>'percentage')::numeric<>88.9 then raise exception 'BAD_EXCLUSION %',result;end if;
 if private.coincidence_t07(aid,gen_random_uuid())->>'state'<>'not_applicable' then raise exception 'OMITTED';end if;
 update private.articles set status='published',published_at=now() where id=aid;
 insert into private.article_user_state(user_id,article_id) values(own,aid) on conflict do nothing;
 perform set_config('request.jwt.claim.sub',own::text,true);
 result:=api.access_results(aid,2);
 if result->'coincidence'<>'null'::jsonb then raise exception 'DISABLED_EXPOSED %',result;end if;
 begin
  update private.metric_controls set enabled=true where metric='coincidence';
  raise exception 'VALIDATION_BYPASSED';
 exception when check_violation then null;end;
 update private.metric_controls set validated_at=now(),validated_by=own,enabled=true where metric='coincidence';
 result:=api.access_results(aid,2);
 if result->'coincidence'->>'state'<>'available' or (result->'coincidence'->>'percentage')::numeric<>88.9 then raise exception 'GATE_RESULT %',result;end if;
end $$;
rollback;
