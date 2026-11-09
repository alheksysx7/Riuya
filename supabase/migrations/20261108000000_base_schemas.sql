-- Z00: solo espacios de nombres; las tablas de producto se definen en Z01.
create schema if not exists api;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke all on schema api from public;
grant usage on schema api to anon, authenticated, service_role;
