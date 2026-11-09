do $$ begin
 if not exists (select 1 from pg_roles where rolname = 'riuya_catalog_reader') then
  create role riuya_catalog_reader nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 end if;
end $$;
grant riuya_catalog_reader to postgres with inherit false;
-- El rol dedicado no es propietario de tablas y solo lee los dos catálogos.
grant usage on schema private to riuya_catalog_reader;
grant select on private.characters, private.categories to riuya_catalog_reader;
create policy catalog_characters_read on private.characters for select to riuya_catalog_reader using (true);
create policy catalog_categories_read on private.categories for select to riuya_catalog_reader using (true);
grant usage, create on schema api to riuya_catalog_reader;
alter function api.list_characters() owner to riuya_catalog_reader;
alter function api.list_categories() owner to riuya_catalog_reader;
revoke create on schema api from riuya_catalog_reader;
revoke all on function api.list_characters() from public;
revoke all on function api.list_categories() from public;
grant execute on function api.list_characters(), api.list_categories() to anon,authenticated;

