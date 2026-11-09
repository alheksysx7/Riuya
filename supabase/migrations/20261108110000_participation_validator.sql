-- El validador diferido comprueba la invariante incluso si la escritura no procede de una RPC.
do $$ begin if not exists(select 1 from pg_roles where rolname='riuya_participation_validator') then create role riuya_participation_validator nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;
grant riuya_participation_validator to postgres with inherit false;
grant usage,create on schema private to riuya_participation_validator;
grant select on private.participations,private.participation_choices,private.opinions to riuya_participation_validator;
create policy participation_validate_parent on private.participations for select to riuya_participation_validator using(true);
create policy participation_validate_choices on private.participation_choices for select to riuya_participation_validator using(true);
create policy participation_validate_opinions on private.opinions for select to riuya_participation_validator using(true);
grant riuya_participation_validator to riuya_participation_executor with inherit false;
set local role riuya_participation_executor;
alter function private.check_participation_choices() owner to riuya_participation_validator;
reset role;
revoke riuya_participation_validator from riuya_participation_executor;
revoke create on schema private from riuya_participation_validator;
