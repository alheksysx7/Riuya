begin;
do $$
declare aid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();oid uuid:=gen_random_uuid();cat uuid:=gen_random_uuid();l1 uuid:=gen_random_uuid();l2 uuid:=gen_random_uuid();h1 text; h2 text; u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();prop jsonb;visible_count integer;changed_count integer;
begin
 if has_table_privilege('anon','private.opinion_aspects','select') or has_table_privilege('authenticated','private.metric_controls','select') or has_function_privilege('authenticated','private.coincidence_t07(uuid,uuid)','execute') then raise exception 'PRIVATE_ACCESS';end if;
 if exists(select 1 from private.metric_controls where enabled) then raise exception 'METRIC_ENABLED';end if;
 insert into private.articles(id,category_id) select aid,id from private.categories limit 1;
 insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values(rid,aid,1,'SIMULACIÓN Z08','Prueba','[]');
 update private.articles set current_revision_id=rid where id=aid;
 insert into private.opinions(id,revision_id,character_id,body) select oid,rid,id,'Opinión de prueba' from private.characters limit 1;
 insert into private.aspect_catalogs(id,version) values(cat,'test-'||cat);
 insert into private.aspect_labels(id,catalog_id,dimension,label_key,definition,positive_examples,negative_examples) values(l1,cat,'emotion','testa','Prueba','["sí"]','["no"]'),(l2,cat,'emotion','testb','Prueba','["sí"]','["no"]');
 h1:=private.editor_revision_hash(rid);
 begin
  insert into private.opinion_aspects(opinion_id,label_id,dimension,weight_basis_points,evidence) values(oid,l1,'emotion',7000,'evidencia');
  set constraints private.aspect_weights immediate;
  raise exception 'INVALID_ACCEPTED';
 exception when check_violation then null; end;
 set constraints private.aspect_weights deferred;
 insert into private.opinion_aspects(opinion_id,label_id,dimension,weight_basis_points,evidence) values(oid,l1,'emotion',7000,'evidencia'),(oid,l2,'emotion',3000,'evidencia');
 set constraints private.aspect_weights immediate;
 h2:=private.editor_revision_hash(rid);if h1=h2 then raise exception 'HASH_UNCHANGED';end if;
 insert into auth.users(id,email) values(u1,'z08-'||u1||'@example.invalid'),(u2,'z08-'||u2||'@example.invalid');
 insert into private.profiles(id) values(u1),(u2);
 insert into private.user_roles(user_id,role) values(u1,'editor'),(u2,'editor');
 if has_function_privilege('anon','api.submit_aspect_proposal(uuid,integer,text,jsonb)','execute') then raise exception 'ANON_PROPOSAL';end if;
 select jsonb_agg(jsonb_build_object('labelId',label_id,'weight',weight_basis_points,'evidence',evidence) order by label_id) into prop from private.opinion_aspects where opinion_id=oid;
 perform set_config('request.jwt.claim.sub',u1::text,true);
 perform api.submit_aspect_proposal(oid,1,'emotion',prop);
 perform set_config('request.jwt.claim.sub',u2::text,true);
 perform api.submit_aspect_proposal(oid,1,'emotion','[]');
 if private.aspect_independent_agreement(oid,'emotion') then raise exception 'DIFFERENT_PROPOSALS_ACCEPTED';end if;
 perform api.submit_aspect_proposal(oid,1,'emotion',prop);
 if not private.aspect_independent_agreement(oid,'emotion') then raise exception 'AGREEMENT_NOT_DETECTED';end if;
 perform set_config('role','riuya_editor_executor',true);
 select count(*) into visible_count from private.aspect_annotation_proposals where opinion_id=oid;
 if visible_count<>1 then raise exception 'REVIEWER_CAN_SEE_OTHERS';end if;
 update private.aspect_catalogs set status='validated',validated_by=u2,validated_at=now() where id=cat;
 get diagnostics changed_count=row_count;
 if changed_count<>0 then raise exception 'EDITOR_CAN_VALIDATE_DIRECTLY';end if;
 perform set_config('role','none',true);
 update private.articles set status='review' where id=aid;
 begin
  update private.aspect_annotation_proposals set proposal='[]' where reviewer_id=u2 and opinion_id=oid;
  raise exception 'FROZEN_PROPOSAL_CHANGED';
 exception when raise_exception then if sqlerrm<>'ASPECT_REVISION_LOCKED' then raise;end if;end;
 begin
  update private.opinion_aspects set evidence='cambiada' where opinion_id=oid;
  raise exception 'FROZEN_ANNOTATION_CHANGED';
 exception when raise_exception then if sqlerrm<>'ASPECT_REVISION_LOCKED' then raise;end if;end;
 begin
  update private.aspect_labels set definition='cambiada' where id=l1;
  raise exception 'FROZEN_LABEL_CHANGED';
 exception when raise_exception then if sqlerrm<>'ASPECT_REVISION_LOCKED' then raise;end if;end;
 if private.coincidence_t07(aid,gen_random_uuid())->>'state'<>'not_applicable' then raise exception 'OMITTED_COINCIDENCE';end if;
end $$;
rollback;

