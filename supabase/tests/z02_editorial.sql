insert into auth.users(id,email) values ('a02b0000-0000-4000-8000-000000000001','z02-editor@example.invalid'),('a02b0000-0000-4000-8000-000000000002','z02-reader@example.invalid');
insert into private.profiles(id) values ('a02b0000-0000-4000-8000-000000000001'),('a02b0000-0000-4000-8000-000000000002');
insert into private.user_roles(user_id,role) values ('a02b0000-0000-4000-8000-000000000001','editor'),('a02b0000-0000-4000-8000-000000000002','user');
create temp table z02_fixture(category uuid,article uuid,revision uuid,version int); insert into z02_fixture(category) select id from private.categories limit 1; grant select,insert,update on z02_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','a02b0000-0000-4000-8000-000000000002',true);
do $$ begin begin perform api.editor_list(); raise exception 'Usuario sin rol accedió'; exception when insufficient_privilege then null; end; end $$;
select set_config('request.jwt.claim.sub','a02b0000-0000-4000-8000-000000000001',true);
do $$
declare payload jsonb; result jsonb; rec record; review_hash text; original_time text;
begin
 payload:=jsonb_build_object('categoryId',(select category from z02_fixture),'title','Titular de prueba','summary',trim(repeat('palabra ',40)),'paragraphs',jsonb_build_array(trim(repeat('texto ',150))||' [f1]'),'sources',jsonb_build_array(jsonb_build_object('key','f1','name','Fuente','date','2026-11-08','url','https://example.invalid')),'opinions',(select jsonb_agg(jsonb_build_object('characterKey',stable_key,'body',trim(repeat('opinion ',40))) order by order_index) from api.list_characters() where order_index<=7));
 begin perform api.editor_save(null,null,'{}'::jsonb); raise exception 'Se aceptaron campos ausentes'; exception when invalid_parameter_value then null; end;
 begin perform api.editor_save(null,null,jsonb_set(payload,'{opinions}',(payload->'opinions') || jsonb_build_array((payload->'opinions'->0),(payload->'opinions'->0)))); raise exception 'Se aceptaron 9 opiniones'; exception when unique_violation then null; end;
 result:=api.editor_save(null,null,payload); update z02_fixture set article=(result->>'id')::uuid,revision=(result->>'revisionId')::uuid,version=(result->>'version')::int;
 select * into rec from z02_fixture;
 result:=api.editor_review(rec.article,rec.version); update z02_fixture set version=(result->>'version')::int; review_hash:=result->>'reviewHash'; select * into rec from z02_fixture; if api.editor_get(rec.article)->>'reviewHash' is distinct from review_hash then raise exception 'Huella no recuperable'; end if;
 begin perform api.editor_publish(rec.article,rec.version,rec.revision,review_hash,true); raise exception 'Se publicaron 7 opiniones'; exception when check_violation then if sqlerrm <> 'EIGHT_OPINIONS_REQUIRED' then raise; end if; end;
 payload:=jsonb_set(payload,'{opinions}',(select jsonb_agg(jsonb_build_object('characterKey',stable_key,'body',trim(repeat('opinion ',40))) order by order_index) from api.list_characters()));
 begin perform api.editor_save(rec.article,rec.version+1,payload); raise exception 'Se aceptó versión obsoleta'; exception when SQLSTATE 'PT409' then null; end;
 result:=api.editor_save(rec.article,rec.version,payload); update z02_fixture set revision=(result->>'revisionId')::uuid,version=(result->>'version')::int; select * into rec from z02_fixture;
 result:=api.editor_review(rec.article,rec.version); update z02_fixture set version=(result->>'version')::int; review_hash:=result->>'reviewHash'; select * into rec from z02_fixture; if api.editor_get(rec.article)->>'reviewHash' is distinct from review_hash then raise exception 'Huella no recuperable'; end if;
 begin perform api.editor_publish(rec.article,rec.version,rec.revision,'incorrecto',true); raise exception 'Se aceptó huella incorrecta'; exception when SQLSTATE 'PT409' then null; end;
 begin perform api.editor_publish(rec.article,rec.version,rec.revision,review_hash,false); raise exception 'Se publicó sin aprobación'; exception when invalid_parameter_value then null; end;
 result:=api.editor_publish(rec.article,rec.version,rec.revision,review_hash,true); if result->>'status'<>'published' then raise exception 'No publicado'; end if;
 if api.public_article(rec.article) is null then raise exception 'Publicación no visible'; end if;
 original_time:=result->>'publishedAt';
 begin perform api.editor_correct(rec.article,(result->>'version')::int,payload,'Corrección',false); raise exception 'Corrección sin aprobación'; exception when invalid_parameter_value then null; end;
 payload:=jsonb_set(payload,'{title}',to_jsonb('Titular corregido'::text));
 result:=api.editor_correct(rec.article,(result->>'version')::int,payload,'Corrección menor ficticia',true);
 if result->>'publishedAt' is distinct from original_time then raise exception 'Cambió fecha de publicación'; end if;
 if api.public_article(rec.article)->>'title'<>'Titular corregido' then raise exception 'Corrección no visible'; end if;
 result:=api.editor_withdraw(rec.article,(result->>'version')::int,'Prueba'); if api.public_article(rec.article) is not null then raise exception 'Retirada visible'; end if; if result->>'status'<>'withdrawn' then raise exception 'No retirado'; end if;
end $$;
reset role;
do $$ begin if has_function_privilege('anon','api.editor_list()','EXECUTE') then raise exception 'Anon puede ejecutar edición'; end if; if has_schema_privilege('authenticated','private','USAGE') then raise exception 'Privado expuesto'; end if; end $$;



do $$ begin if private.editor_word_count('uno [f1] https://example.invalid dos') <> 2 or private.editor_word_count('uno'||chr(160)||'dos') <> 2 then raise exception 'Conteo incorrecto'; end if; end $$;


do $$ declare aid uuid:=(select article from z02_fixture); begin
 if (select count(*) from private.editorial_events where article_id=aid and event_type='publish') <> 1 or (select count(*) from private.editorial_events where article_id=aid and event_type='correct' and reason='Corrección menor ficticia') <> 1 or (select count(*) from private.editorial_events where article_id=aid and event_type='withdraw') <> 1 then raise exception 'Auditoría editorial incorrecta'; end if;
 if not exists(select 1 from private.article_revisions where article_id=aid and correction_note='Corrección menor ficticia') then raise exception 'Falta nota de corrección'; end if;
end $$;
