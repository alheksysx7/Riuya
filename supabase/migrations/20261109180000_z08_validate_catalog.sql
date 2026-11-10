-- Validación humana explícita. El RLS también exige administrador activo.
grant update on private.aspect_catalogs to riuya_editor_executor;
create policy admin_aspect_catalog_update on private.aspect_catalogs for update to riuya_editor_executor
 using(exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and x.role='admin' and p.account_status='active'))
 with check(exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid and x.role='admin' and p.account_status='active'));
grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create function api.validate_aspect_catalog(p_catalog_id uuid,p_version text,p_confirm boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; c private.aspect_catalogs%rowtype;
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role='admin' and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'APPROVAL_REQUIRED' using errcode='22023';end if;
 select * into c from private.aspect_catalogs where id=p_catalog_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if c.status<>'proposed' or c.version is distinct from p_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if not exists(select 1 from private.aspect_labels where catalog_id=c.id) then raise exception 'EMPTY_CATALOG' using errcode='23514';end if;
 update private.aspect_catalogs set status='validated',validated_at=now(),validated_by=uid where id=c.id;
 return jsonb_build_object('catalogId',c.id,'version',c.version,'status','validated');
end $$;
revoke all on function api.validate_aspect_catalog(uuid,text,boolean) from public,anon;
grant execute on function api.validate_aspect_catalog(uuid,text,boolean) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;
