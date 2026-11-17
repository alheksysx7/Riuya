-- Conservar decisiones editoriales sin conservar la identidad de un editor eliminado.
alter table private.source_group_proposals add column decision_actor_deleted boolean not null default false;
alter table private.source_group_proposals drop constraint source_group_proposals_check1;
alter table private.source_group_proposals add constraint source_group_decision_actor check(
 (status='proposed' and decided_by is null and not decision_actor_deleted and decided_at is null and event_id is null) or
 (status='rejected' and ((decided_by is not null and not decision_actor_deleted) or (decided_by is null and decision_actor_deleted)) and decided_at is not null and event_id is null) or
 (status='confirmed' and ((decided_by is not null and not decision_actor_deleted) or (decided_by is null and decision_actor_deleted)) and decided_at is not null and event_id is not null));
alter table private.aspect_catalogs add column validator_deleted boolean not null default false;
alter table private.aspect_catalogs drop constraint aspect_catalogs_check;
alter table private.aspect_catalogs add constraint aspect_catalog_validator check(
 (status='proposed' and validated_at is null and validated_by is null and not validator_deleted) or
 (status in ('validated','retired') and validated_at is not null and ((validated_by is not null and not validator_deleted) or (status='retired' and validated_by is null and validator_deleted))));

-- La excepción solo permite eliminar el vínculo del actor durante la transacción de purga privilegiada.
create or replace function private.aspect_before_change() returns trigger language plpgsql set search_path='' as $$
declare oid uuid;state text;actor text:=current_setting('riuya.purge_actor',true);
begin
 if tg_op='UPDATE' and current_user='riuya_purge_executor' and actor is not null and (old.reviewed_by::text=actor or old.second_reviewed_by::text=actor) and new.reviewed_by is not distinct from (case when old.reviewed_by::text=actor then old.second_reviewed_by else old.reviewed_by end) and new.second_reviewed_by is null and (to_jsonb(new)-'reviewed_by'-'second_reviewed_by')=(to_jsonb(old)-'reviewed_by'-'second_reviewed_by') then return new;end if;
 oid:=case when tg_op='DELETE' then old.opinion_id else new.opinion_id end;
 if tg_op='UPDATE' and new.opinion_id<>old.opinion_id then raise exception 'ASPECT_OPINION_IMMUTABLE';end if;
 select a.status into state from private.opinions o join private.article_revisions r on r.id=o.revision_id join private.articles a on a.id=r.article_id where o.id=oid for update of a;
 perform 1 from private.opinions where id=oid for update;
 if state in ('review','published','withdrawn') then raise exception 'ASPECT_REVISION_LOCKED';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create or replace function private.aspect_proposal_guard() returns trigger language plpgsql set search_path='' as $$
declare oid uuid;st text;actor text:=current_setting('riuya.purge_actor',true);
begin
 if tg_op='DELETE' and current_user='riuya_purge_executor' and old.reviewer_id::text=actor then return old;end if;
 oid:=case when tg_op='DELETE' then old.opinion_id else new.opinion_id end;
 if tg_op='UPDATE' and (new.opinion_id<>old.opinion_id or new.dimension<>old.dimension or new.reviewer_id<>old.reviewer_id) then raise exception 'PROPOSAL_ID_IMMUTABLE';end if;
 select a.status into st from private.opinions o join private.article_revisions r on r.id=o.revision_id join private.articles a on a.id=r.article_id where o.id=oid for update of a;
 if st in ('review','published','withdrawn') then raise exception 'ASPECT_REVISION_LOCKED';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create or replace function private.aspect_catalog_guard() returns trigger language plpgsql set search_path='' as $$
declare actor text:=current_setting('riuya.purge_actor',true);
begin
 if current_user='riuya_purge_executor' and actor is not null and old.validated_by::text=actor and new.validated_by is null and new.validator_deleted and new.status='retired' and (to_jsonb(new)-'status'-'validated_by'-'validator_deleted')=(to_jsonb(old)-'status'-'validated_by'-'validator_deleted') then return new;end if;
 if old.status in ('validated','retired') and (new.version is distinct from old.version or new.validated_at is distinct from old.validated_at or new.validated_by is distinct from old.validated_by or new.validator_deleted is distinct from old.validator_deleted or new.status not in (old.status,'retired')) then raise exception 'ASPECT_CATALOG_LOCKED';end if;
 return new;
end $$;


-- Permisos exclusivos del rol de purga, sin acceso directo del cliente o worker.
grant select,update on private.articles,private.article_revisions,private.editorial_events,
 private.opinion_aspects,private.aspect_catalogs,private.metric_controls,private.sources,private.source_group_proposals to riuya_purge_executor;
grant select,delete on private.aspect_annotation_proposals to riuya_purge_executor;
grant select on private.opinions to riuya_purge_executor;
do $$ declare n text;begin
 foreach n in array array['articles','article_revisions','editorial_events','opinion_aspects','aspect_catalogs','metric_controls','sources','source_group_proposals','aspect_annotation_proposals','opinions'] loop
  execute format('create policy %I on private.%I for select to riuya_purge_executor using(true)','purge_editor_read_'||n,n);
 end loop;
 foreach n in array array['articles','article_revisions','editorial_events','opinion_aspects','aspect_catalogs','metric_controls','sources','source_group_proposals'] loop
  execute format('create policy %I on private.%I for update to riuya_purge_executor using(true) with check(true)','purge_editor_update_'||n,n);
 end loop;
end $$;
create policy purge_proposal_delete on private.aspect_annotation_proposals for delete to riuya_purge_executor using(true);
grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
create function private.purge_editorial_references(p_job uuid,p_token uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;uid uuid;has_aspects boolean;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'<>'contributions_removed' then raise exception 'PURGE_STATE_INVALID';end if;
 uid:=(st->>'userId')::uuid;
 -- Invalidar revisiones en curso antes de cambiar cualquier elemento de su huella.
 update private.articles a set status='draft',version=a.version+1,updated_at=clock_timestamp()
 where a.status='review' and (
  exists(select 1 from private.article_revisions r where r.id=a.current_revision_id and r.created_by=uid)
  or exists(select 1 from private.opinions o join private.opinion_aspects x on x.opinion_id=o.id where o.revision_id=a.current_revision_id and (x.reviewed_by=uid or x.second_reviewed_by=uid))
  or exists(select 1 from private.opinions o join private.aspect_annotation_proposals x on x.opinion_id=o.id where o.revision_id=a.current_revision_id and x.reviewer_id=uid));
 select exists(select 1 from private.opinion_aspects where reviewed_by=uid or second_reviewed_by=uid)
     or exists(select 1 from private.aspect_annotation_proposals where reviewer_id=uid)
     or exists(select 1 from private.aspect_catalogs where validated_by=uid) into has_aspects;
 if has_aspects then update private.metric_controls set enabled=false where metric='aspects';end if;
 update private.metric_controls set enabled=false,validated_by=null,validated_at=null where validated_by=uid;
 perform set_config('riuya.purge_actor',uid::text,true);
 update private.opinion_aspects set
  reviewed_by=case when reviewed_by=uid then second_reviewed_by else reviewed_by end,
  second_reviewed_by=null
 where reviewed_by=uid or second_reviewed_by=uid;
 delete from private.aspect_annotation_proposals where reviewer_id=uid;
 update private.aspect_catalogs set status='retired',validated_by=null,validator_deleted=true where validated_by=uid;
 perform set_config('riuya.purge_actor','',true);
 update private.source_group_proposals set decided_by=null,decision_actor_deleted=true where decided_by=uid;
 update private.sources set verified=false,verified_by=null,version=version+1 where verified_by=uid;
 update private.article_revisions set created_by=null where created_by=uid;
 update private.articles set created_by=case when created_by=uid then null else created_by end,
  approved_by=case when approved_by=uid then null else approved_by end
 where created_by=uid or approved_by=uid;
 update private.editorial_events set actor_id=null where actor_id=uid;
 return 'editorial_references_removed';
end $$;
revoke all on function private.purge_editorial_references(uuid,uuid) from public,anon,authenticated;
reset role;
-- El trigger diferido puede ejecutarse tras salir del SECURITY DEFINER;
-- valida con un propietario sin login que sí ve todas las anotaciones.
alter function private.aspect_validate_weights() security definer;
alter function private.aspect_validate_weights() owner to riuya_purge_executor;
revoke create on schema private from riuya_purge_executor;
