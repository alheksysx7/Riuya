grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create or replace function private.storage_purge_path_owned(p_bucket text,p_name text,p_owner text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 begin c:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;exception when others then return false;end;
 if p_owner is null or c->>'sub' is distinct from p_owner then return false;end if;
 return not exists(select 1 from storage.objects x where x.bucket_id=p_bucket and x.name=p_name
  and (coalesce(x.owner_id,x.owner::text) is distinct from p_owner or (x.owner is not null and x.owner_id is not null and x.owner::text<>x.owner_id)));
end $$;
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
drop policy riuya_purge_storage_select on storage.objects;
drop policy riuya_purge_storage_delete on storage.objects;
create policy riuya_purge_storage_select on storage.objects for select to riuya_storage_purger
 using(coalesce(owner_id,owner::text)=(current_setting('request.jwt.claims',true)::jsonb->>'sub')
   and (owner is null or owner_id is null or owner::text=owner_id)
   and (select private.storage_purge_authorized())
   and private.storage_purge_path_owned(bucket_id,name,(current_setting('request.jwt.claims',true)::jsonb->>'sub')));
create policy riuya_purge_storage_delete on storage.objects for delete to riuya_storage_purger
 using(coalesce(owner_id,owner::text)=(current_setting('request.jwt.claims',true)::jsonb->>'sub')
   and (owner is null or owner_id is null or owner::text=owner_id)
   and (select private.storage_purge_authorized())
   and private.storage_purge_path_owned(bucket_id,name,(current_setting('request.jwt.claims',true)::jsonb->>'sub')));
