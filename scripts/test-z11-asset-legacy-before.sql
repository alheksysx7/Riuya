create temporary table z11_legacy_fixture(uid uuid,rid uuid,jid uuid,tok uuid,asset_id uuid);
insert into z11_legacy_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select uid,'z11-asset-legacy-'||uid||'@example.invalid' from z11_legacy_fixture;
insert into private.profiles(id,account_status) select uid,'deletion_pending' from z11_legacy_fixture;
insert into private.account_deletion_requests(id,user_id,requested_at,recover_until,status) select rid,uid,now()-interval '8 days',now()-interval '1 day','pending' from z11_legacy_fixture;
insert into private.jobs(id,job_type,payload,dedupe_key,created_by,status,locked_by,lease_token,lease_until) select jid,'account.purge',jsonb_build_object('requestId',rid),'z11-legacy-'||jid,uid,'running','fixture',tok,now()+interval '1 hour' from z11_legacy_fixture;
insert into private.assets(id,path,mime_type,sha256,owner_id,version,validation_status) select asset_id,'unknown','image/png',repeat('a',64),uid,'1','provisional' from z11_legacy_fixture;
