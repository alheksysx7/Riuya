grant create on schema private to riuya_restore_executor;
set local role riuya_restore_executor;
create or replace function private.restore_begin_purge(p_user uuid,p_request uuid) returns jsonb
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
 -- Reanudar un trabajo creado antes de que se registrara la operación.
 select * into j from private.jobs where created_by=p_user and job_type='account.purge'
  and payload->>'requestId'=p_request::text and locked_by='restore-offline' and status='running' for update;
 if found then
  if r.id is null or p.account_status<>'deletion_pending' or r.recover_until>clock_timestamp() then raise exception 'RESTORE_STATE_INVALID';end if;
  if j.lease_until>clock_timestamp() then raise exception 'RESTORE_IN_PROGRESS';end if;
  update private.jobs set lease_token=tok,lease_until=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp()
   where id=j.id returning * into j;
  perform private.restore_revoke_sessions(j.id,tok);
  return jsonb_build_object('id',j.id,'type',j.job_type,'leaseToken',tok,'leaseUntil',j.lease_until);
 end if;
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
reset role;
revoke create on schema private from riuya_restore_executor;
