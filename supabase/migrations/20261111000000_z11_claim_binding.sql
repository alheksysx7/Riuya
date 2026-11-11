grant create on schema private to riuya_deletion_user;
set local role riuya_deletion_user;
create or replace function private.recent_password_session(p_uid uuid,p_since timestamptz default null) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;sid uuid;entry jsonb;ts timestamptz;
begin
 begin sid:=(claims->>'session_id')::uuid;if (claims->>'sub')::uuid is distinct from p_uid then return false;end if;exception when others then return false;end;
 if sid is null or not private.current_session_is_live() or jsonb_typeof(claims->'amr') is distinct from 'array' then return false;end if;
 for entry in select * from jsonb_array_elements(claims->'amr') loop
  if entry->>'method'='password' and entry->>'timestamp' ~ '^[0-9]{1,12}$' then
   ts:=to_timestamp((entry->>'timestamp')::double precision);
   if ts>=now()-interval '5 minutes' and ts<=now()+interval '5 seconds' and (p_since is null or ts>=date_trunc('second',p_since)) then return true;end if;
  end if;
 end loop;
 return false;
end $$;
reset role;
revoke create on schema private from riuya_deletion_user;
