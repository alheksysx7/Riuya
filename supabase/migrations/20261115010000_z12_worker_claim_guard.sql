-- La función histórica no distingue trabajos de purga; el worker usa la versión filtrada.
set local role riuya_job_executor;
revoke execute on function private.claim_job(text,integer) from riuya_worker_client;
reset role;

-- La comprobación de salud debe aceptar esta nueva versión, sin aceptar futuras.
create or replace function api.health_schema_compatible()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261115010000'
  ) and not exists (
    select 1 from supabase_migrations.schema_migrations
    where version !~ '^[0-9]{14}$' or version > '20261115010000'
  );
$$;
