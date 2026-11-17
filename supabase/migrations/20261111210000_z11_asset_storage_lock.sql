-- El bloqueo del activo se mantiene durante la autorización y eliminación
-- de Storage, evitando que aparezca una nueva referencia FK concurrente.
grant update(owner_id) on private.assets to riuya_storage_inventory;
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create or replace function private.storage_purge_path_owned(p_bucket text,p_name text,p_owner text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare c jsonb;uid uuid;
begin
 begin c:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;uid:=(c->>'sub')::uuid;exception when others then return false;end;
 if uid is null or p_owner is distinct from uid::text then return false;end if;
 perform 1 from private.assets where storage_bucket_id=p_bucket and storage_object_name=p_name and owner_id=uid order by id for update;
 if exists(select 1 from storage.objects x where x.bucket_id=p_bucket and x.name=p_name
   and (coalesce(x.owner_id,x.owner::text) is distinct from p_owner or (x.owner is not null and x.owner_id is not null and x.owner::text<>x.owner_id)))
 then return false;end if;
 if exists(select 1 from private.assets a where a.storage_bucket_id=p_bucket and a.storage_object_name=p_name and a.owner_id is distinct from uid)
  or exists(select 1 from private.assets a join private.profiles p on p.avatar_asset_id=a.id where a.storage_bucket_id=p_bucket and a.storage_object_name=p_name and a.owner_id=uid and p.id<>uid)
  or exists(select 1 from private.assets a join private.characters x on x.portrait_asset_id=a.id where a.storage_bucket_id=p_bucket and a.storage_object_name=p_name and a.owner_id=uid)
 then return false;end if;
 return true;
end $$;
reset role;
revoke create on schema private from riuya_storage_inventory;
