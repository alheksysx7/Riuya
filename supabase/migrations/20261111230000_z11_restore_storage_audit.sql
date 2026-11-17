-- Verifica si sobreviven objetos de Storage atribuibles a cada identidad.
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create function private.restore_storage_present(p_users uuid[])
returns table(user_id uuid,storage_present boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_users is null or cardinality(p_users)>1000 or array_position(p_users,null) is not null then
  raise exception 'RESTORE_AUDIT_INVALID';
 end if;
 return query
 select x.id,exists(select 1 from storage.objects o where o.owner=x.id or o.owner_id=x.id::text)
 from (select distinct unnest(p_users) id) x;
end $$;
revoke all on function private.restore_storage_present(uuid[]) from public,anon,authenticated;
grant execute on function private.restore_storage_present(uuid[]) to riuya_restore_auditor;
reset role;
revoke create on schema private from riuya_storage_inventory;
