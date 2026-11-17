-- Rol de prueba para el handler, aún sin vincular al worker operativo.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_purge_worker_client') then
 create role riuya_purge_worker_client nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
end if;end $$;
grant riuya_purge_worker_client to postgres with inherit false;
grant usage on schema private to riuya_purge_worker_client;
grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
grant execute on function private.begin_account_purge(uuid,uuid),private.purge_account_contributions(uuid,uuid),private.purge_editorial_references(uuid,uuid),private.prepare_account_auth_purge(uuid,uuid),private.finish_account_purge(uuid,uuid) to riuya_purge_worker_client;
reset role;
revoke create on schema private from riuya_purge_executor;
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
grant execute on function private.purge_storage_inventory(uuid,uuid) to riuya_purge_worker_client;
reset role;
revoke create on schema private from riuya_storage_inventory;
