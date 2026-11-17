set local role riuya_purge_executor;
grant execute on function private.purge_account_contributions(uuid,uuid),private.purge_editorial_references(uuid,uuid),private.prepare_account_auth_purge(uuid,uuid) to postgres;
reset role;
set local role riuya_storage_inventory;
grant execute on function private.purge_storage_inventory(uuid,uuid) to postgres;
reset role;
do $$
declare f z11_legacy_fixture%rowtype;
begin
 select * into f from z11_legacy_fixture;
 perform private.purge_account_contributions(f.jid,f.tok);perform private.purge_editorial_references(f.jid,f.tok);
 begin perform private.purge_storage_inventory(f.jid,f.tok);raise exception 'UNMAPPED_ASSET_ALLOWED';exception when raise_exception then if sqlerrm<>'PURGE_ASSET_MAPPING_UNSUPPORTED' then raise;end if;end;
 begin perform private.prepare_account_auth_purge(f.jid,f.tok);raise exception 'UNMAPPED_PREPARED';exception when raise_exception then if sqlerrm<>'PURGE_ASSET_MAPPING_UNSUPPORTED' then raise;end if;end;
 if not exists(select 1 from private.assets where id=f.asset_id) or not exists(select 1 from auth.users where id=f.uid) then raise exception 'LEGACY_DATA_LOST';end if;
end $$;
rollback;
