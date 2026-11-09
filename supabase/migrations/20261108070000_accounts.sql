-- Z04: inicialización idempotente del perfil propio para una identidad autenticada.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_account_executor') then create role riuya_account_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;
grant riuya_account_executor to postgres with inherit false;
grant usage on schema private to riuya_account_executor;
grant select,insert on private.profiles,private.user_roles to riuya_account_executor;
create policy account_own_profiles on private.profiles for select to riuya_account_executor using(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy account_create_profiles on private.profiles for insert to riuya_account_executor with check(id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and account_status='active');
create policy account_own_roles on private.user_roles for select to riuya_account_executor using(user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy account_create_user_role on private.user_roles for insert to riuya_account_executor with check(role='user' and user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
grant usage,create on schema api to riuya_account_executor;
create function api.account_ensure_profile() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='42501'; end if;
 insert into private.profiles(id) values(uid) on conflict(id) do nothing;
 select account_status into account_state from private.profiles where id=uid;
 if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501'; end if;
 insert into private.user_roles(user_id,role) values(uid,'user') on conflict(user_id,role) do nothing;
 return jsonb_build_object('id',uid,'status',account_state);
end $$;
alter function api.account_ensure_profile() owner to riuya_account_executor;
revoke create on schema api from riuya_account_executor;
set local role riuya_account_executor;
revoke all on function api.account_ensure_profile() from public,anon;
grant execute on function api.account_ensure_profile() to authenticated;
reset role;
