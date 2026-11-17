begin;
do $$
declare aid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();cat uuid:=gen_random_uuid();l1 uuid:=gen_random_uuid();l2 uuid:=gen_random_uuid();l3 uuid:=gen_random_uuid();u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];o uuid;i integer;prop jsonb;payload jsonb;
begin
 if has_table_privilege('anon','private.opinion_aspects','select') then raise exception 'ACCENT_TABLE_ACCESS';end if;
 if has_function_privilege('anon','private.reader_emotion_accent(uuid)','execute') or has_function_privilege('authenticated','private.reader_emotion_accent(uuid)','execute') then raise exception 'ACCENT_FUNCTION_ACCESS';end if;
 insert into auth.users(id,email) values(u1,'accent-'||u1||'@example.invalid'),(u2,'accent-'||u2||'@example.invalid');
 insert into private.profiles(id) values(u1),(u2);
 insert into private.user_roles(user_id,role) values(u1,'admin'),(u2,'editor');
 insert into private.articles(id,category_id) select aid,id from private.categories limit 1;
 insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values(rid,aid,1,'SIMULACIÓN ACENTOS','Prueba ficticia','[]');
 update private.articles set current_revision_id=rid where id=aid;
 insert into private.opinions(id,revision_id,character_id,body)
 select ids[order_index],rid,id,'Opinión ficticia' from private.characters where order_index<=5;
 insert into private.aspect_catalogs(id,version) values(cat,'accent-'||cat);
 insert into private.aspect_labels(id,catalog_id,dimension,label_key,definition,positive_examples,negative_examples) values
 (l1,cat,'emotion','empatia','Prueba','["sí"]','["no"]'),(l2,cat,'emotion','esperanza','Prueba','["sí"]','["no"]'),(l3,cat,'emotion','desconocida','Prueba','["sí"]','["no"]');
 insert into private.opinion_aspects(opinion_id,label_id,dimension,weight_basis_points,evidence) values
 (ids[1],l1,'emotion',10000,'texto ficticio'),
 (ids[2],l1,'emotion',10000,'texto ficticio'),
 (ids[3],l3,'emotion',10000,'texto ficticio'),
 (ids[4],l1,'emotion',7000,'texto ficticio'),(ids[4],l2,'emotion',3000,'texto ficticio');
 for i in 1..4 loop
  o:=ids[i];
  select jsonb_agg(jsonb_build_object('labelId',label_id,'weight',weight_basis_points,'evidence',evidence) order by label_id) into prop from private.opinion_aspects where opinion_id=o;
  insert into private.aspect_annotation_proposals(opinion_id,dimension,reviewer_id,proposal) values(o,'emotion',u1,prop);
  if o<>ids[2] then insert into private.aspect_annotation_proposals(opinion_id,dimension,reviewer_id,proposal) values(o,'emotion',u2,prop);end if;
 end loop;
 update private.articles set status='published',published_at=now() where id=aid;
 if (select item->>'emotionAccent' from jsonb_array_elements(api.reader_article(aid)->'opinions') item where item->>'id'=ids[1]::text) is not null then raise exception 'ACCENT_DISABLED_LEAK';end if;
 update private.metric_controls set enabled=true,validated_at=now(),validated_by=u1,catalog_id=cat where metric='aspects';
 if (select item->>'emotionAccent' from jsonb_array_elements(api.reader_article(aid)->'opinions') item where item->>'id'=ids[1]::text) is not null then raise exception 'ACCENT_UNVALIDATED_LEAK';end if;
 perform set_config('request.jwt.claim.sub',u1::text,true);
 perform api.validate_aspect_catalog(cat,'accent-'||cat,true);
 if (select item->>'emotionAccent' from jsonb_array_elements(api.reader_article(aid)->'opinions') item where item->>'id'=ids[1]::text) is distinct from 'empatia' then raise exception 'ACCENT_VALID_MISSING';end if;
 if (select item->>'emotionAccent' from jsonb_array_elements(api.reader_article(aid)->'opinions') item where item->>'id'=ids[2]::text) is not null then raise exception 'ACCENT_NO_CONSENSUS';end if;
 if (select item->>'emotionAccent' from jsonb_array_elements(api.reader_article(aid)->'opinions') item where item->>'id'=ids[3]::text) is not null then raise exception 'ACCENT_UNKNOWN_LABEL';end if;
 if (select item->>'emotionAccent' from jsonb_array_elements(api.reader_article(aid)->'opinions') item where item->>'id'=ids[5]::text) is not null then raise exception 'ACCENT_MISSING_CLASSIFICATION';end if;
 if (select item->>'emotionAccent' from jsonb_array_elements(api.reader_article(aid)->'opinions') item where item->>'id'=ids[4]::text) is distinct from 'empatia' then raise exception 'ACCENT_DOMINANT';end if;
 set local role anon;
 payload:=api.reader_article(aid);
 reset role;
 if payload::text like '%texto ficticio%' or payload::text like '%evidence%' then raise exception 'ACCENT_EVIDENCE_LEAK';end if;
 if payload::text like '%'||u1::text||'%' or payload::text like '%'||u2::text||'%' then raise exception 'ACCENT_REVIEWER_LEAK';end if;
 if (select item->>'emotionAccent' from jsonb_array_elements(payload->'opinions') item where item->>'id'=ids[1]::text) is distinct from 'empatia' then raise exception 'ACCENT_DTO';end if;
 update private.articles set status='withdrawn',withdrawn_at=now(),withdrawal_reason='prueba' where id=aid;
 if api.reader_article(aid) is not null then raise exception 'ACCENT_WITHDRAWN_LEAK';end if;
end $$;
rollback;
