grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create or replace function private.purge_storage_inventory(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;uid uuid;result jsonb;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'<>'editorial_cleaned' then raise exception 'PURGE_STATE_INVALID';end if;
 uid:=(st->>'userId')::uuid;
 -- Rutas del catálogo antiguo carecen de una asociación inequívoca a bucket;
 -- no se termina la purga hasta resolverlas explícitamente.
 if exists(select 1 from private.assets where owner_id=uid) then raise exception 'PURGE_ASSET_MAPPING_UNSUPPORTED';end if;
 if exists(select 1 from storage.objects o where o.owner=uid and o.owner_id is null) then raise exception 'PURGE_STORAGE_LEGACY_OWNER_UNSUPPORTED';end if;
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
reset role;
revoke create on schema private from riuya_storage_inventory;
