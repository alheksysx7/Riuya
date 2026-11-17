-- Preparación para Auth y finalización verificable. Aún no se concede al worker.
grant update(alias,avatar_asset_id,appearance,locale,timezone,hide_confirmation,updated_at) on private.profiles to riuya_purge_executor;
grant select,delete on private.user_roles,private.generation_runs to riuya_purge_executor;
grant delete,update(locked_by,lease_token,lease_until,updated_at) on private.jobs to riuya_purge_executor;
create policy purge_roles_read on private.user_roles for select to riuya_purge_executor using(true);
create policy purge_roles_delete on private.user_roles for delete to riuya_purge_executor using(true);
create policy purge_generations_read on private.generation_runs for select to riuya_purge_executor using(true);
create policy purge_generations_delete on private.generation_runs for delete to riuya_purge_executor using(true);
create policy purge_jobs_delete on private.jobs for delete to riuya_purge_executor using(true);
grant create on schema private to riuya_storage_inventory;
set local role riuya_storage_inventory;
grant execute on function private.purge_storage_inventory(uuid,uuid) to riuya_purge_executor;
reset role;
revoke create on schema private from riuya_storage_inventory;

-- Auth no permite delegar lectura de auth.users al rol limitado en local.
-- Este helper deriva la identidad del trabajo y nunca acepta un usuario arbitrario.
create function private.purge_auth_user_missing(p_job uuid,p_token uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.jobs j join private.account_purge_operations o on o.job_id=j.id
  where j.id=p_job and j.job_type='account.purge' and j.status='running' and p_token is not null
   and j.lease_token=p_token and j.lease_until>clock_timestamp() and o.stage='prepared'
   and not exists(select 1 from auth.users u where u.id=o.user_id))
$$;
revoke all on function private.purge_auth_user_missing(uuid,uuid) from public,anon,authenticated;
grant execute on function private.purge_auth_user_missing(uuid,uuid) to riuya_purge_executor;

grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
create function private.prepare_account_auth_purge(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;uid uuid;pending jsonb;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'='prepared' then return st;end if;
 if st->>'stage'<>'editorial_cleaned' then raise exception 'PURGE_STATE_INVALID';end if;
 uid:=(st->>'userId')::uuid;
 pending:=private.purge_storage_inventory(p_job,p_token);
 if jsonb_array_length(pending)<>0 then raise exception 'PURGE_STORAGE_NOT_EMPTY';end if;
 if exists(select 1 from private.account_purge_operations o join private.jobs j on j.id=o.job_id where j.created_by=uid and j.id<>p_job) then raise exception 'PURGE_OTHER_OPERATION';end if;
 delete from private.generation_runs where job_id in (select id from private.jobs where created_by=uid and id<>p_job);
 delete from private.jobs where created_by=uid and id<>p_job;
 delete from private.user_roles where user_id=uid;
 update private.profiles set alias=null,avatar_asset_id=null,appearance='system',locale='es',timezone='UTC',hide_confirmation=false,updated_at=clock_timestamp() where id=uid;
 update private.account_purge_operations set stage='prepared',updated_at=clock_timestamp() where job_id=p_job and user_id=uid and stage='editorial_cleaned';
 if not found then raise exception 'PURGE_STATE_INVALID';end if;
 return jsonb_build_object('stage','prepared','userId',uid);
end $$;

create function private.finish_account_purge(p_job uuid,p_token uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare op private.account_purge_operations%rowtype;j private.jobs%rowtype;
begin
 select * into j from private.jobs where id=p_job for update;
 if not found or j.job_type<>'account.purge' or j.status<>'running' or p_token is null
   or j.lease_token is distinct from p_token or j.lease_until is null or j.lease_until<=clock_timestamp()
 then raise exception 'PURGE_LEASE_INVALID';end if;
 select * into op from private.account_purge_operations where job_id=p_job for update;
 if not found or op.stage<>'prepared' or op.user_id is null then raise exception 'PURGE_STATE_INVALID';end if;
 if not private.purge_auth_user_missing(p_job,p_token) then raise exception 'PURGE_AUTH_STILL_EXISTS';end if;
 update private.account_purge_operations set user_id=null,stage='finalized',updated_at=clock_timestamp() where job_id=p_job;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=p_job;
 return true;
end $$;
revoke all on function private.prepare_account_auth_purge(uuid,uuid),private.finish_account_purge(uuid,uuid) from public,anon,authenticated;
reset role;
revoke create on schema private from riuya_purge_executor;
