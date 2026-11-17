-- La limpieza editorial queda registrada antes de inspeccionar Storage.
alter table private.account_purge_operations drop constraint account_purge_operations_stage_check;
alter table private.account_purge_operations add constraint account_purge_operations_stage_check
 check(stage in ('started','contributions_removed','editorial_cleaned','prepared','finalized'));
grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
create or replace function private.begin_account_purge(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare req_id uuid; uid uuid; profile_status text; req private.account_deletion_requests%rowtype;
 job private.jobs%rowtype; op private.account_purge_operations%rowtype;
begin
 -- Lecturas preliminares no confirman identidad ni autorización.
 select nullif(payload->>'requestId','')::uuid,created_by into req_id,uid
 from private.jobs where id=p_job and job_type='account.purge';
 if not found or req_id is null then raise exception 'PURGE_UNAVAILABLE'; end if;
 select * into op from private.account_purge_operations where job_id=p_job;
 if found and op.stage='prepared' then
   select * into job from private.jobs where id=p_job for update;
   if job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until is null or job.lease_until<=clock_timestamp() or p_token is null then raise exception 'PURGE_LEASE_INVALID'; end if;
   return jsonb_build_object('stage',op.stage,'userId',op.user_id);
 end if;
 if uid is null then raise exception 'PURGE_UNAVAILABLE'; end if;
 -- Igual que recuperación: perfil, solicitud y trabajo, en ese orden.
 select account_status into profile_status from private.profiles where id=uid for update;
 if not found or profile_status<>'deletion_pending' then raise exception 'PURGE_UNAVAILABLE'; end if;
 select * into req from private.account_deletion_requests where id=req_id and user_id=uid for update;
 if not found or req.status not in ('pending','purging') or clock_timestamp()<req.recover_until then raise exception 'PURGE_UNAVAILABLE'; end if;
 select * into job from private.jobs where id=p_job for update;
 if not found or job.job_type<>'account.purge' or job.created_by is distinct from uid
   or job.payload->>'requestId' is distinct from req_id::text
   or job.status<>'running' or p_token is null or job.lease_token is distinct from p_token
   or job.lease_until is null or job.lease_until<=clock_timestamp() then raise exception 'PURGE_LEASE_INVALID'; end if;
 insert into private.account_purge_operations(request_id,job_id,user_id,stage)
 values(req_id,p_job,uid,'started')
 on conflict(request_id) do nothing;
 select * into op from private.account_purge_operations where request_id=req_id for update;
 if op.job_id is distinct from p_job or op.user_id is distinct from uid or op.stage not in ('started','contributions_removed','editorial_cleaned') then raise exception 'PURGE_STATE_INVALID'; end if;
 update private.account_deletion_requests set status='purging' where id=req_id;
 return jsonb_build_object('stage',op.stage,'userId',uid);
end $$;
create or replace function private.purge_editorial_references(p_job uuid,p_token uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;uid uuid;has_aspects boolean;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'='editorial_cleaned' then return 'editorial_references_removed';end if;
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
 update private.account_purge_operations set stage='editorial_cleaned',updated_at=clock_timestamp() where job_id=p_job and user_id=uid;
 return 'editorial_references_removed';
end $$;

revoke all on function private.begin_account_purge(uuid,uuid),private.purge_editorial_references(uuid,uuid) from public,anon,authenticated;
reset role;
revoke create on schema private from riuya_purge_executor;

-- Rol no login, con BYPASSRLS solo para leer las columnas explícitas concedidas.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_storage_inventory') then
 create role riuya_storage_inventory nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
end if;end $$;
grant riuya_storage_inventory to postgres with inherit false;
grant usage on schema private,storage to riuya_storage_inventory;
grant select(bucket_id,name,owner,owner_id,is_versioned,archived_at,is_delete_marker) on storage.objects to riuya_storage_inventory;
grant select(owner_id) on private.assets to riuya_storage_inventory;
grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
grant execute on function private.begin_account_purge(uuid,uuid) to riuya_storage_inventory;
reset role;
revoke create on schema private from riuya_purge_executor;
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create function private.purge_storage_inventory(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;uid uuid;result jsonb;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'<>'editorial_cleaned' then raise exception 'PURGE_STATE_INVALID';end if;
 uid:=(st->>'userId')::uuid;
 -- Rutas del catálogo antiguo carecen de una asociación inequívoca a bucket;
 -- no se termina la purga hasta resolverlas explícitamente.
 if exists(select 1 from private.assets where owner_id=uid) then raise exception 'PURGE_ASSET_MAPPING_UNSUPPORTED';end if;
 if exists(select 1 from storage.objects o where (o.owner=uid or o.owner_id=uid::text)
  and ((o.owner is not null and o.owner<>uid) or (o.owner_id is not null and o.owner_id<>uid::text)))
 then raise exception 'PURGE_STORAGE_OWNER_CONFLICT';end if;
 if exists(select 1 from storage.objects o where (o.owner=uid or o.owner_id=uid::text)
  and (o.is_versioned or o.archived_at is not null or o.is_delete_marker))
 then raise exception 'PURGE_STORAGE_VERSION_UNSUPPORTED';end if;
 -- No tocar una ruta cuando otra fila, versión o identidad también la reclama.
 if exists(select 1 from storage.objects o join storage.objects x on x.bucket_id=o.bucket_id and x.name=o.name
  where (o.owner=uid or o.owner_id=uid::text) and not (x.owner is not distinct from o.owner and x.owner_id is not distinct from o.owner_id))
 then raise exception 'PURGE_STORAGE_OWNER_CONFLICT';end if;
 select coalesce(jsonb_agg(jsonb_build_object('bucket_id',q.bucket_id,'name',q.name,'is_versioned',q.is_versioned,'archived_at',q.archived_at,'is_delete_marker',q.is_delete_marker) order by q.bucket_id,q.name),'[]'::jsonb)
 into result from (select bucket_id,name,is_versioned,archived_at,is_delete_marker from storage.objects
  where owner=uid or owner_id=uid::text order by bucket_id,name limit 100) q;
 return result;
end $$;
revoke all on function private.purge_storage_inventory(uuid,uuid) from public,anon,authenticated;
reset role;
revoke create on schema private from riuya_storage_inventory;
