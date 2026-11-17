-- Identidad mínima para registrar una supresión, derivada del trabajo autorizado.
grant create on schema private to riuya_purge_executor;
set local role riuya_purge_executor;
create function private.purge_journal_context(p_job uuid,p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare st jsonb;rid uuid;uid uuid;
begin
 st:=private.begin_account_purge(p_job,p_token);
 if st->>'stage'<>'prepared' then raise exception 'PURGE_STATE_INVALID';end if;
 uid:=(st->>'userId')::uuid;
 select request_id into rid from private.account_purge_operations where job_id=p_job and user_id=uid and stage='prepared';
 if not found then raise exception 'PURGE_STATE_INVALID';end if;
 return jsonb_build_object('requestId',rid,'userId',uid);
end $$;
revoke all on function private.purge_journal_context(uuid,uuid) from public,anon,authenticated;
grant execute on function private.purge_journal_context(uuid,uuid) to riuya_purge_worker_client;
reset role;
revoke create on schema private from riuya_purge_executor;
