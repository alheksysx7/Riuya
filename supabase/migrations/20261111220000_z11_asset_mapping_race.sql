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
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.jsonb_build_array(p_bucket,p_name)::text,20261111));
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

-- Las escrituras privilegiadas de mapeo participan en el mismo bloqueo por ruta.
grant select(account_status) on private.profiles to riuya_storage_inventory;
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create function private.guard_asset_storage_mapping() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if new.storage_bucket_id is null or new.storage_object_name is null then return new;end if;
 if tg_op='UPDATE' and new.storage_bucket_id is not distinct from old.storage_bucket_id
  and new.storage_object_name is not distinct from old.storage_object_name
  and new.owner_id is not distinct from old.owner_id then return new;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.jsonb_build_array(new.storage_bucket_id,new.storage_object_name)::text,20261111));
 if exists(
  select 1 from private.assets a join private.profiles p on p.id=a.owner_id
  where a.id is distinct from new.id and a.storage_bucket_id=new.storage_bucket_id
   and a.storage_object_name=new.storage_object_name and a.owner_id is distinct from new.owner_id
   and p.account_status is distinct from 'active'
 ) or exists(
  select 1 from storage.objects o join private.profiles p on (p.id::text=o.owner_id or p.id=o.owner)
  where o.bucket_id=new.storage_bucket_id and o.name=new.storage_object_name
   and p.id is distinct from new.owner_id and p.account_status is distinct from 'active'
 ) then raise exception 'ASSET_STORAGE_PURGE_IN_PROGRESS' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.guard_asset_storage_mapping() from public,anon,authenticated;
grant execute on function private.guard_asset_storage_mapping() to postgres;
reset role;
revoke create on schema private from riuya_storage_inventory;
create trigger guard_asset_storage_mapping before insert or update of owner_id,storage_bucket_id,storage_object_name
on private.assets for each row execute function private.guard_asset_storage_mapping();
set local role riuya_storage_inventory;
revoke execute on function private.guard_asset_storage_mapping() from postgres;
reset role;
