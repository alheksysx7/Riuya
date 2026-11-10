grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create function api.editor_set_source_active(p_id uuid,p_expected_version integer,p_active boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;s private.sources%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles r join private.profiles p on p.id=r.user_id where r.user_id=uid and r.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_active is null then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
 select * into s from private.sources where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if s.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if p_active and (not s.verified or s.verified_by is null) then raise exception 'VERIFICATION_REQUIRED' using errcode='22023';end if;
 update private.sources set is_active=p_active,version=version+1 where id=s.id returning * into s;
 return jsonb_build_object('id',s.id,'version',s.version,'active',s.is_active);
end $$;
revoke all on function api.editor_set_source_active(uuid,integer,boolean) from public,anon;
grant execute on function api.editor_set_source_active(uuid,integer,boolean) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;
