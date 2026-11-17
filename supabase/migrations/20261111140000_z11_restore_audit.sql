-- Auditoría de restauración: solo uso operativo, sin acceso de usuarios o worker.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_restore_auditor') then
 create role riuya_restore_auditor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
end if;end $$;
grant riuya_restore_auditor to postgres with inherit false;
grant usage on schema private to riuya_restore_auditor;

-- Auth no delega acceso directo a auth.users; el resultado solo contiene
-- presencia y estado para identificadores proporcionados por la auditoría.
create function private.restore_purge_audit(p_users uuid[])
returns table(user_id uuid,auth_present boolean,profile_present boolean,account_status text)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_users is null or cardinality(p_users)>1000 or array_position(p_users,null) is not null then raise exception 'RESTORE_AUDIT_INVALID';end if;
 return query select x.id,exists(select 1 from auth.users a where a.id=x.id),
  p.id is not null,p.account_status
 from (select distinct unnest(p_users) id) x left join private.profiles p on p.id=x.id;
end $$;
revoke all on function private.restore_purge_audit(uuid[]) from public,anon,authenticated;
grant execute on function private.restore_purge_audit(uuid[]) to riuya_restore_auditor;
