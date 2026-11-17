-- Estado mínimo sin divulgar configuración ni datos de usuario.
create function api.health_schema_compatible()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261115000000'
  ) and not exists (
    select 1 from supabase_migrations.schema_migrations
    where version !~ '^[0-9]{14}$' or version > '20261115000000'
  );
$$;
alter function api.health_schema_compatible() owner to postgres;
revoke all on function api.health_schema_compatible() from public;
grant execute on function api.health_schema_compatible() to anon, authenticated;
