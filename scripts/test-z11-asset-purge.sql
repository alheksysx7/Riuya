begin;
set local role riuya_purge_executor;
grant execute on function private.purge_account_contributions(uuid,uuid),private.purge_editorial_references(uuid,uuid),private.prepare_account_auth_purge(uuid,uuid) to postgres;
reset role;
set local role riuya_storage_inventory;
grant execute on function private.purge_storage_inventory(uuid,uuid) to postgres;
reset role;
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();tok uuid:=gen_random_uuid();asset uuid:=gen_random_uuid();otherAsset uuid:=gen_random_uuid();bucket text:='z11-asset-'||gen_random_uuid();items jsonb;
begin
 insert into auth.users(id,email) values(u,'z11-asset-'||u||'@example.invalid'),(v,'z11-asset-'||v||'@example.invalid');
 insert into private.profiles(id,account_status) values(u,'deletion_pending'),(v,'active');
 insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values(rid,u,now()-interval '8 days',now()-interval '1 day','pending');
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values(jid,'account.purge',jsonb_build_object('requestId',rid),'z11-asset-'||jid,u,'running','fixture',tok,now()+interval '1 hour');
 perform private.purge_account_contributions(jid,tok);perform private.purge_editorial_references(jid,tok);
 insert into private.assets(id,path,mime_type,sha256,owner_id,version,validation_status,storage_bucket_id,storage_object_name)
 values(asset,'fixture','image/png',repeat('a',64),u,'1','provisional',bucket,'avatar.png');
 update private.profiles set avatar_asset_id=asset where id in (u,v);
 begin perform private.purge_storage_inventory(jid,tok);raise exception 'SHARED_PROFILE_ALLOWED';exception when raise_exception then if sqlerrm<>'PURGE_ASSET_SHARED' then raise;end if;end;
 update private.profiles set avatar_asset_id=null where id=v;
 begin
  insert into private.assets(id,path,mime_type,sha256,owner_id,version,validation_status,storage_bucket_id,storage_object_name)
  values(otherAsset,'fixture-other','image/png',repeat('b',64),v,'1','provisional',bucket,'avatar.png');
  raise exception 'NEW_SHARED_MAPPING_ALLOWED';
 exception when check_violation then if sqlerrm<>'ASSET_STORAGE_PURGE_IN_PROGRESS' then raise;end if;end;
 -- Un vínculo creado antes de la baja continúa bloqueando la purga.
 update private.profiles set account_status='active' where id=u;
 insert into private.assets(id,path,mime_type,sha256,owner_id,version,validation_status,storage_bucket_id,storage_object_name)
 values(otherAsset,'fixture-other','image/png',repeat('b',64),v,'1','provisional',bucket,'avatar.png');
 update private.profiles set account_status='deletion_pending' where id=u;
 begin perform private.purge_storage_inventory(jid,tok);raise exception 'SHARED_MAPPING_ALLOWED';exception when raise_exception then if sqlerrm<>'PURGE_ASSET_SHARED' then raise;end if;end;
 delete from private.assets where id=otherAsset;
 begin
  insert into storage.buckets(id,name) values(bucket,bucket);
  insert into storage.objects(bucket_id,name,owner_id,version) values(bucket,'avatar.png',v::text,'fixture-version');
  begin perform private.purge_storage_inventory(jid,tok);raise exception 'OTHER_OWNER_ALLOWED';exception when raise_exception then if sqlerrm<>'PURGE_ASSET_OWNER_CONFLICT' then raise;end if;end;
  update storage.objects set owner_id=u::text where bucket_id=bucket and name='avatar.png';
  items:=private.purge_storage_inventory(jid,tok);
  if jsonb_array_length(items)<>1 or items->0->>'name'<>'avatar.png' then raise exception 'MAPPED_OBJECT_MISSING';end if;
  begin perform private.prepare_account_auth_purge(jid,tok);raise exception 'OBJECT_STILL_PRESENT_ALLOWED';exception when raise_exception then if sqlerrm<>'PURGE_STORAGE_NOT_EMPTY' then raise;end if;end;
  raise exception 'ROLLBACK_STORAGE_FIXTURE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_STORAGE_FIXTURE' then raise;end if;end;
 if (private.prepare_account_auth_purge(jid,tok)->>'stage')<>'prepared' then raise exception 'NOT_PREPARED';end if;
 if exists(select 1 from private.assets where id=asset) or (select avatar_asset_id from private.profiles where id=u) is not null then raise exception 'ASSET_NOT_REMOVED';end if;
 if not exists(select 1 from auth.users where id=v) then raise exception 'OTHER_ACCOUNT_LOST';end if;
end $$;
rollback;
