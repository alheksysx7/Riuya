-- Solo entorno de prueba: todas las modificaciones se revierten.
begin;
do $$ begin
 if not api.health_schema_compatible() then raise exception 'Z12_HEALTH_EXPECTED_READY'; end if;
 if has_table_privilege('anon','supabase_migrations.schema_migrations','select') then raise exception 'Z12_HEALTH_HISTORY_EXPOSED'; end if;
 if not has_function_privilege('anon','api.health_schema_compatible()','execute') then raise exception 'Z12_HEALTH_GRANT_MISSING'; end if;
end $$;
set local role anon;
select api.health_schema_compatible();
reset role;
insert into supabase_migrations.schema_migrations(version) values ('99999999999999');
do $$ begin
 if api.health_schema_compatible() then raise exception 'Z12_HEALTH_FUTURE_ACCEPTED'; end if;
end $$;
rollback;
