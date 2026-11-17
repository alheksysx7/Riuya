-- Los activos personales nuevos identifican de manera explícita su objeto.
alter table private.assets add column storage_bucket_id text;
alter table private.assets add column storage_object_name text;
alter table private.assets add constraint assets_storage_pair check(
 (storage_bucket_id is null and storage_object_name is null) or
 (storage_bucket_id is not null and storage_object_name is not null and length(storage_bucket_id) between 1 and 100 and length(storage_object_name) between 1 and 1024)
) not valid;
alter table private.assets add constraint assets_owned_storage_required check(
 owner_id is null or (storage_bucket_id is not null and storage_object_name is not null)
) not valid;
grant select(id,owner_id,storage_bucket_id,storage_object_name) on private.assets to riuya_storage_inventory;
grant select(id,avatar_asset_id) on private.profiles to riuya_storage_inventory;
grant select(portrait_asset_id) on private.characters to riuya_storage_inventory;
grant select,delete,update(owner_id) on private.assets to riuya_purge_executor;
create policy purge_assets_read on private.assets for select to riuya_purge_executor using(true);
create policy purge_assets_lock on private.assets for update to riuya_purge_executor using(true) with check(true);
create policy purge_assets_delete on private.assets for delete to riuya_purge_executor using(true);
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create or replace function private.purge_storage_inventory(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;uid uuid;result jsonb;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'<>'editorial_cleaned' then raise exception 'PURGE_STATE_INVALID';end if;
 uid:=(st->>'userId')::uuid;
 -- Un activo antiguo sin ubicación explícita requiere resolución operativa.
 if exists(select 1 from private.assets where owner_id=uid and (storage_bucket_id is null or storage_object_name is null))
 then raise exception 'PURGE_ASSET_MAPPING_UNSUPPORTED';end if;
 if exists(select 1 from private.assets a join private.profiles p on p.avatar_asset_id=a.id where a.owner_id=uid and p.id<>uid)
  or exists(select 1 from private.assets a join private.characters c on c.portrait_asset_id=a.id where a.owner_id=uid)
  or exists(select 1 from private.assets a join private.assets b on b.storage_bucket_id=a.storage_bucket_id and b.storage_object_name=a.storage_object_name and b.id<>a.id where a.owner_id=uid and b.owner_id is distinct from uid)
 then raise exception 'PURGE_ASSET_SHARED';end if;
 if exists(select 1 from private.assets a join storage.objects o on o.bucket_id=a.storage_bucket_id and o.name=a.storage_object_name
  where a.owner_id=uid and (coalesce(o.owner_id,o.owner::text) is distinct from uid::text
   or (o.owner is not null and o.owner_id is not null and o.owner::text<>o.owner_id)))
 then raise exception 'PURGE_ASSET_OWNER_CONFLICT';end if;
 if exists(select 1 from storage.objects o where (o.owner=uid or o.owner_id=uid::text)
  and ((o.owner is not null and o.owner<>uid) or (o.owner_id is not null and o.owner_id<>uid::text)))
 then raise exception 'PURGE_STORAGE_OWNER_CONFLICT';end if;
 if exists(select 1 from storage.objects o where (o.owner=uid or o.owner_id=uid::text)
  and (o.version is null or length(o.version)=0))
 then raise exception 'PURGE_STORAGE_VERSION_MISSING';end if;
 -- No tocar una ruta cuando otra fila, versión o identidad también la reclama.
 if exists(select 1 from storage.objects o join storage.objects x on x.bucket_id=o.bucket_id and x.name=o.name
  where (o.owner=uid or o.owner_id=uid::text) and (coalesce(x.owner_id,x.owner::text) is distinct from uid::text or (x.owner is not null and x.owner_id is not null and x.owner::text<>x.owner_id)))
 then raise exception 'PURGE_STORAGE_OWNER_CONFLICT';end if;
 select coalesce(jsonb_agg(jsonb_build_object('bucket_id',q.bucket_id,'name',q.name,'is_versioned',q.is_versioned,'archived_at',q.archived_at,'is_delete_marker',q.is_delete_marker,'version',q.version) order by q.bucket_id,q.name,q.version),'[]'::jsonb)
 into result from (select bucket_id,name,is_versioned,archived_at,is_delete_marker,version from storage.objects
  where owner=uid or owner_id=uid::text order by bucket_id,name,version limit 100) q;
 return result;
end $$;
reset role;
revoke create on schema private from riuya_storage_inventory;
grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
create or replace function private.prepare_account_auth_purge(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;uid uuid;pending jsonb;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'='prepared' then return st;end if;
 if st->>'stage'<>'editorial_cleaned' then raise exception 'PURGE_STATE_INVALID';end if;
 uid:=(st->>'userId')::uuid;
 -- Bloquear los activos impide nuevas referencias FK antes de validarlos.
 perform 1 from private.assets where owner_id=uid order by id for update;
 pending:=private.purge_storage_inventory(p_job,p_token);
 if jsonb_array_length(pending)<>0 then raise exception 'PURGE_STORAGE_NOT_EMPTY';end if;
 if exists(select 1 from private.account_purge_operations o join private.jobs j on j.id=o.job_id where j.created_by=uid and j.id<>p_job) then raise exception 'PURGE_OTHER_OPERATION';end if;
 delete from private.generation_runs where job_id in (select id from private.jobs where created_by=uid and id<>p_job);
 delete from private.jobs where created_by=uid and id<>p_job;
 delete from private.user_roles where user_id=uid;
 update private.profiles set alias=null,avatar_asset_id=null,appearance='system',locale='es',timezone='UTC',hide_confirmation=false,updated_at=clock_timestamp() where id=uid;
 delete from private.assets where owner_id=uid;
 update private.account_purge_operations set stage='prepared',updated_at=clock_timestamp() where job_id=p_job and user_id=uid and stage='editorial_cleaned';
 if not found then raise exception 'PURGE_STATE_INVALID';end if;
 return jsonb_build_object('stage','prepared','userId',uid);
end $$;

reset role;
revoke create on schema private from riuya_purge_executor;
