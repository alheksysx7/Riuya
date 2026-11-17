-- Preparación de una reaplicación sin exponer capacidades al worker habitual.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='riuya_restore_executor') then create role riuya_restore_executor nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;end if;
 if not exists(select 1 from pg_roles where rolname='riuya_restore_client') then create role riuya_restore_client nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;end if;
end $$;
grant riuya_restore_executor,riuya_restore_client to postgres with inherit false;
grant usage on schema private to riuya_restore_executor,riuya_restore_client;
grant select,update(account_status) on private.profiles to riuya_restore_executor;
grant select,insert,update on private.account_deletion_requests to riuya_restore_executor;
grant select,insert,update on private.jobs to riuya_restore_executor;
grant select,update(stage) on private.account_purge_operations to riuya_restore_executor;
grant select,update(status) on private.notification_deliveries to riuya_restore_executor;

-- Auth no permite delegar sesiones al rol limitado. La cuenta se deriva
-- estrictamente de un trabajo restaurado y validado, no de un UUID arbitrario.
create function private.restore_revoke_sessions(p_job uuid,p_token uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid;
begin
 select j.created_by into uid from private.jobs j
 join private.profiles p on p.id=j.created_by and p.account_status='deletion_pending'
 join private.account_deletion_requests r on r.user_id=p.id and r.id::text=j.payload->>'requestId' and r.status='pending' and r.recover_until<=clock_timestamp()
 where j.id=p_job and j.job_type='account.purge' and j.locked_by='restore-offline' and j.status='running'
  and j.lease_token=p_token and j.lease_until>clock_timestamp();
 if uid is null then raise exception 'RESTORE_JOB_INVALID';end if;
 delete from auth.sessions where user_id=uid;
end $$;
revoke all on function private.restore_revoke_sessions(uuid,uuid) from public,anon,authenticated;
grant execute on function private.restore_revoke_sessions(uuid,uuid) to riuya_restore_executor;

grant create on schema private to riuya_restore_executor;
set local role riuya_restore_executor;
create function private.restore_begin_purge(p_user uuid,p_request uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p private.profiles%rowtype;r private.account_deletion_requests%rowtype;o private.account_purge_operations%rowtype;
 j private.jobs%rowtype;has_profile boolean;tok uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();at_time timestamptz;
begin
 if p_user is null or p_request is null then raise exception 'RESTORE_INVALID';end if;
 select * into p from private.profiles where id=p_user for update;has_profile:=found;
 select * into o from private.account_purge_operations where request_id=p_request for update;
 if found then
  if o.user_id is distinct from p_user or o.stage='finalized' then raise exception 'RESTORE_STATE_INVALID';end if;
  select * into j from private.jobs where id=o.job_id for update;
  if not found or j.job_type<>'account.purge' or j.payload->>'requestId' is distinct from p_request::text
    or (j.created_by is distinct from p_user and not (o.stage='prepared' and j.created_by is null))
    or j.status='succeeded' then raise exception 'RESTORE_STATE_INVALID';end if;
  if o.stage<>'prepared' and (not has_profile or p.account_status<>'deletion_pending'
    or not exists(select 1 from private.account_deletion_requests where id=p_request and user_id=p_user and status='purging'))
   then raise exception 'RESTORE_STATE_INVALID';end if;
  if j.status='running' and j.lease_until>clock_timestamp() then raise exception 'RESTORE_IN_PROGRESS';end if;
  update private.jobs set status='running',locked_by='restore-offline',lease_token=tok,
   lease_until=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'type',j.job_type,'leaseToken',tok,'leaseUntil',j.lease_until);
 end if;
 if not has_profile then return null;end if;
 select * into r from private.account_deletion_requests where user_id=p_user for update;
 if found and (r.id<>p_request or r.status<>'pending') then raise exception 'RESTORE_STATE_INVALID';end if;
 if exists(select 1 from private.account_deletion_requests where id=p_request and user_id<>p_user) then raise exception 'RESTORE_STATE_INVALID';end if;
 at_time:=clock_timestamp()-interval '8 days';
 if r.id is null then
  insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status)
   values(p_request,p_user,at_time,at_time+interval '7 days','pending');
 else
  update private.account_deletion_requests set requested_at=at_time,recover_until=at_time+interval '7 days' where id=p_request;
 end if;
 update private.profiles set account_status='deletion_pending' where id=p_user;
 update private.notification_deliveries set status='cancelled' where user_id=p_user and status='queued';
 update private.jobs set status='cancelled',locked_by=null,lease_token=null,lease_until=null,updated_at=clock_timestamp()
  where created_by=p_user and status in ('queued','running');
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until)
  values(jid,'account.purge',jsonb_build_object('requestId',p_request),'restore:'||jid,p_user,'running','restore-offline',tok,clock_timestamp()+interval '10 minutes') returning * into j;
 perform private.restore_revoke_sessions(j.id,tok);
 return jsonb_build_object('id',j.id,'type',j.job_type,'leaseToken',tok,'leaseUntil',j.lease_until);
end $$;
revoke all on function private.restore_begin_purge(uuid,uuid) from public,anon,authenticated;
grant execute on function private.restore_begin_purge(uuid,uuid) to riuya_restore_client;
reset role;
revoke create on schema private from riuya_restore_executor;

-- Una operación interrumpida también impide declarar lista la restauración,
-- incluso si Auth ya se eliminó y falta solamente finalizar.
drop function private.restore_purge_audit(uuid[]);
create function private.restore_purge_audit(p_users uuid[])
returns table(user_id uuid,auth_present boolean,profile_present boolean,account_status text,pending_purge boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_users is null or cardinality(p_users)>1000 or array_position(p_users,null) is not null then raise exception 'RESTORE_AUDIT_INVALID';end if;
 return query select x.id,exists(select 1 from auth.users a where a.id=x.id),p.id is not null,p.account_status,
  exists(select 1 from private.account_purge_operations o where o.user_id=x.id and o.stage<>'finalized')
 from (select distinct unnest(p_users) id) x left join private.profiles p on p.id=x.id;
end $$;
revoke all on function private.restore_purge_audit(uuid[]) from public,anon,authenticated;
grant execute on function private.restore_purge_audit(uuid[]) to riuya_restore_auditor;
