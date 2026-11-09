begin;
do $$ begin
 if (select count(*) from private.characters) <> 8 then raise exception 'Deben existir 8 voces'; end if;
 if (select array_agg(stable_key order by order_index) from private.characters) <> array['rami','beatriz','leo','dmitri','naoki','salma','tove','kavya'] then raise exception 'Orden incorrecto'; end if;
 if (select count(*) from private.categories) <> 6 then raise exception 'Deben existir 6 categorías'; end if;
 if has_schema_privilege('anon','private','USAGE') or has_schema_privilege('authenticated','private','USAGE') then raise exception 'Esquema privado expuesto'; end if;
 if has_table_privilege('anon','private.user_roles','INSERT') or has_table_privilege('authenticated','private.user_roles','INSERT') then raise exception 'Roles modificables por cliente'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Falta RLS'; end if;
 begin insert into private.characters(stable_key,name,order_index) values ('noveno','Noveno',9); raise exception 'Se aceptó un noveno personaje'; exception when check_violation then null; end;
 begin insert into private.characters(stable_key,name,order_index) values ('rami','Rami',1); raise exception 'Se aceptó un duplicado'; exception when unique_violation then null; end;
 begin insert into private.categories(name,slug) values ('Prueba','slug inválido'); raise exception 'Se aceptó un slug inválido'; exception when check_violation then null; end;
end $$;
insert into auth.users(id,email) values ('a01b0000-0000-4000-8000-000000000001','z01-fixture@example.invalid');
insert into private.profiles(id) values ('a01b0000-0000-4000-8000-000000000001');
insert into private.user_roles(user_id,role) values ('a01b0000-0000-4000-8000-000000000001','user'),('a01b0000-0000-4000-8000-000000000001','editor'),('a01b0000-0000-4000-8000-000000000001','admin');
do $$ begin
 if (select count(*) from private.user_roles where user_id='a01b0000-0000-4000-8000-000000000001') <> 3 then raise exception 'Roles válidos no guardados'; end if;
 begin insert into private.user_roles(user_id,role) values ('a01b0000-0000-4000-8000-000000000001','owner'); raise exception 'Rol inválido aceptado'; exception when check_violation then null; end;
end $$;
set local role anon;
do $$ begin
 if (select count(*) from api.list_characters()) <> 8 then raise exception 'API anon no devuelve ocho voces'; end if;
 if (select count(*) from api.list_categories()) <> 6 then raise exception 'API anon no devuelve seis categorías'; end if;
 begin perform * from private.user_roles; raise exception 'Acceso privado permitido'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 if (select count(*) from api.list_characters()) <> 8 then raise exception 'API autenticada sin acceso'; end if;
 begin perform * from private.profiles; raise exception 'Perfiles privados expuestos'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

