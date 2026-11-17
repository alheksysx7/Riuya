begin;
set local role riuya_purge_executor;
grant execute on function private.purge_account_contributions(uuid,uuid),private.purge_editorial_references(uuid,uuid) to postgres;
reset role;
set local role riuya_storage_inventory;
grant execute on function private.purge_storage_inventory(uuid,uuid) to postgres;
reset role;
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();tok uuid:=gen_random_uuid();bucket text:='z11-inventory-'||gen_random_uuid();entry uuid:=gen_random_uuid();other uuid:=gen_random_uuid();bad uuid:=gen_random_uuid();obj jsonb;
begin
 if pg_has_role('riuya_worker_local','riuya_storage_inventory','member') or has_table_privilege('riuya_storage_inventory','storage.objects','delete') or not has_column_privilege('riuya_storage_inventory','storage.objects','owner_id','select') then raise exception 'ROLE_SCOPE';end if;
 if has_function_privilege('authenticated','private.purge_storage_inventory(uuid,uuid)','execute') or has_function_privilege('riuya_worker_local','private.purge_storage_inventory(uuid,uuid)','execute') then raise exception 'EXPOSED';end if;
 insert into auth.users(id,email) values(u,'z11-storage-'||u||'@example.invalid'),(v,'z11-storage-'||v||'@example.invalid');
 insert into private.profiles(id,account_status) values(u,'deletion_pending'),(v,'active');
 insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) values(rid,u,now()-interval '8 days',now()-interval '1 day','pending');
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) values(jid,'account.purge',jsonb_build_object('requestId',rid),'z11-storage-'||jid,u,'running','fixture',tok,now()+interval '1 hour');
 begin perform private.purge_storage_inventory(jid,tok);raise exception 'EARLY_INVENTORY';exception when raise_exception then if sqlerrm<>'PURGE_STATE_INVALID' then raise;end if;end;
 perform private.purge_account_contributions(jid,tok);perform private.purge_editorial_references(jid,tok);
 insert into storage.buckets(id,name) values(bucket,bucket);
 -- Metadatos sintéticos: sin archivos físicos y con rollback integral.
 insert into storage.objects(id,bucket_id,name,owner_id,version) values(entry,bucket,'own/a',u::text,'fixture-version'),(other,bucket,'other/b',v::text,'other-version');
 begin perform private.purge_storage_inventory(jid,gen_random_uuid());raise exception 'BAD_LEASE_ACCEPTED';exception when raise_exception then if sqlerrm<>'PURGE_LEASE_INVALID' then raise;end if;end;
 obj:=private.purge_storage_inventory(jid,tok);
 if jsonb_array_length(obj)<>1 or obj->0->>'name'<>'own/a' or obj->0->>'bucket_id'<>bucket then raise exception 'INVENTORY_SCOPE %',obj;end if;
 insert into storage.objects(id,bucket_id,name,owner,owner_id) values(bad,bucket,'ambiguous',v,u::text);
 begin perform private.purge_storage_inventory(jid,tok);raise exception 'AMBIGUITY_ACCEPTED';exception when raise_exception then if sqlerrm<>'PURGE_STORAGE_OWNER_CONFLICT' then raise;end if;end;
 update storage.objects set owner_id=v::text where id=bad;
 update storage.objects set is_versioned=true where id=entry;
 obj:=private.purge_storage_inventory(jid,tok);
 if not (obj->0->>'is_versioned')::boolean or obj->0->>'version'<>'fixture-version' then raise exception 'VERSION_NOT_RETURNED';end if;
 update storage.objects set is_versioned=false,version=null where id=entry;
 begin perform private.purge_storage_inventory(jid,tok);raise exception 'MISSING_VERSION_ACCEPTED';exception when raise_exception then if sqlerrm<>'PURGE_STORAGE_VERSION_MISSING' then raise;end if;end;
 update storage.objects set version='fixture-version' where id=entry;
 update storage.objects set owner=u,owner_id=null where id=entry;
 obj:=private.purge_storage_inventory(jid,tok);
 if jsonb_array_length(obj)<>1 or obj->0->>'name'<>'own/a' then raise exception 'LEGACY_OWNER_NOT_RETURNED';end if;
 update storage.objects set owner_id=u::text where id=entry;
 begin
  insert into private.assets(path,mime_type,sha256,owner_id,version,validation_status) values('unmapped','image/png',repeat('a',64),u,'1','provisional');
  raise exception 'NEW_UNMAPPED_ASSET_ACCEPTED';
 exception when check_violation then null;end;
 if (select account_status from private.profiles where id=v)<>'active' then raise exception 'OTHER_ACCOUNT';end if;
end $$;
rollback;
