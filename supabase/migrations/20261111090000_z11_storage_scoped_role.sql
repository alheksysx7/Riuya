-- Storage aplica las políticas al objeto bloqueado, sin usar service_role.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_storage_purger') then
 create role riuya_storage_purger nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
end if;end $$;
grant riuya_storage_purger to authenticator;
grant usage on schema storage,private to riuya_storage_purger;
grant select,delete on storage.objects to riuya_storage_purger;

-- El propietario del helper no tiene login. Sus permisos se reducen a las
-- columnas necesarias para comprobar el trabajo, la solicitud y el perfil.
grant select(id,created_by,job_type,status,lease_token,lease_until,payload) on private.jobs to riuya_storage_inventory;
grant select(job_id,user_id,request_id,stage) on private.account_purge_operations to riuya_storage_inventory;
grant select(id,user_id,status,recover_until) on private.account_deletion_requests to riuya_storage_inventory;
grant select(id,account_status) on private.profiles to riuya_storage_inventory;
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
create function private.storage_purge_authorized() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare c jsonb;uid uuid;jid uuid;tok uuid;
begin
 begin
  c:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  uid:=(c->>'sub')::uuid;jid:=(c->>'purge_job')::uuid;tok:=(c->>'purge_lease')::uuid;
 exception when others then return false;end;
 if uid is null or jid is null or tok is null or c->>'role'<>'riuya_storage_purger' then return false;end if;
 return exists(
  select 1 from private.jobs j
  join private.account_purge_operations op on op.job_id=j.id and op.user_id=uid and op.stage='editorial_cleaned'
  join private.account_deletion_requests r on r.id=op.request_id and r.user_id=uid and r.status='purging'
  join private.profiles p on p.id=uid and p.account_status='deletion_pending'
  where j.id=jid and j.created_by=uid and j.job_type='account.purge' and j.status='running'
    and j.lease_token=tok and j.lease_until>clock_timestamp() and r.recover_until<=clock_timestamp()
    and j.payload->>'requestId'=r.id::text);
end $$;
revoke all on function private.storage_purge_authorized() from public,anon,authenticated;
grant execute on function private.storage_purge_authorized() to riuya_storage_purger;
reset role;
revoke create on schema private from riuya_storage_inventory;

-- Solo el objeto de la cuenta del trabajo puede consultarse o eliminarse.
create policy riuya_purge_storage_select on storage.objects for select to riuya_storage_purger
 using(owner_id=(current_setting('request.jwt.claims',true)::jsonb->>'sub')
   and (owner is null or owner::text=owner_id) and not is_versioned and archived_at is null and not is_delete_marker
   and (select private.storage_purge_authorized()));
create policy riuya_purge_storage_delete on storage.objects for delete to riuya_storage_purger
 using(owner_id=(current_setting('request.jwt.claims',true)::jsonb->>'sub')
   and (owner is null or owner::text=owner_id) and not is_versioned and archived_at is null and not is_delete_marker
   and (select private.storage_purge_authorized()));
