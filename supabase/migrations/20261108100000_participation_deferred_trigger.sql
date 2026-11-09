-- Los triggers diferidos se ejecutan al COMMIT, fuera de la función RPC.
-- Su propietario limitado conserva RLS y solo puede comprobar la participación propia.
grant create on schema private to riuya_participation_executor;
alter function private.check_participation_choices() security definer;
alter function private.check_participation_choices() owner to riuya_participation_executor;
revoke create on schema private from riuya_participation_executor;
