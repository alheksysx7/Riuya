-- Señal conservadora: no atribuye ni elimina objetos sin identidad verificable.
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create function private.restore_unattributed_storage_present() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from storage.objects o
  where o.owner is null and (o.owner_id is null or o.owner_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 );
$$;
revoke all on function private.restore_unattributed_storage_present() from public,anon,authenticated;
grant execute on function private.restore_unattributed_storage_present() to riuya_restore_auditor;
reset role;
revoke create on schema private from riuya_storage_inventory;
