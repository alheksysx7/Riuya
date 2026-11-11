create or replace function private.current_session_is_live() returns boolean language plpgsql stable security definer set search_path='' as $$
declare claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;uid uuid;sid uuid;
begin
 begin uid:=(claims->>'sub')::uuid;sid:=(claims->>'session_id')::uuid;exception when others then return false;end;
 if uid is null or sid is null then return false;end if;
 return exists(select 1 from auth.sessions where id=sid and user_id=uid and (not_after is null or not_after>clock_timestamp()));
end $$;
