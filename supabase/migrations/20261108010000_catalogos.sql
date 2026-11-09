create table private.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 alias text check (alias is null or length(btrim(alias)) between 1 and 40),
 avatar_asset_id uuid,
 account_status text not null default 'active' check (account_status in ('active','deletion_pending')),
 appearance text not null default 'system' check (appearance in ('system','light','dark')),
 locale text not null default 'es' check (locale = 'es'),
 timezone text not null default 'UTC',
 hide_confirmation boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table private.user_roles (
 user_id uuid not null references private.profiles(id) on delete cascade,
 role text not null check (role in ('user','editor','admin')),
 created_at timestamptz not null default now(), primary key (user_id,role)
);
create table private.assets (
 id uuid primary key default gen_random_uuid(), path text not null, mime_type text not null,
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), owner_id uuid references private.profiles(id) on delete set null,
 version text not null, validation_status text not null check (validation_status in ('provisional','approved')),
 attribution text, license text, created_at timestamptz not null default now()
);
alter table private.profiles add constraint profiles_avatar_fk foreign key (avatar_asset_id) references private.assets(id) on delete set null;
create table private.characters (
 id uuid primary key default gen_random_uuid(), stable_key text not null unique,
 name text not null, order_index smallint not null unique, biography text, traits text[],
 canon_version text not null default 'V3.1', portrait_asset_id uuid references private.assets(id) on delete set null,
 is_active boolean not null default true, created_at timestamptz not null default now(),
 constraint canonical_cast check ((stable_key,name,order_index) in (('rami','Rami',1),('beatriz','Beatriz',2),('leo','Leo',3),('dmitri','Dmitri',4),('naoki','Naoki',5),('salma','Salma',6),('tove','Tove',7),('kavya','Kavya',8)))
);
create table private.categories (
 id uuid primary key default gen_random_uuid(), name text not null unique check (length(btrim(name)) between 1 and 80),
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table private.sources (
 id uuid primary key default gen_random_uuid(), name text not null, domain text not null,
 source_type text not null check (source_type in ('rss','atom','api','manual')),
 base_url text not null check (base_url ~ '^https?://'), verified boolean not null default false,
 is_active boolean not null default true, usage_policy text, fetch_interval_minutes integer not null default 30 check (fetch_interval_minutes >= 1),
 last_fetched_at timestamptz, created_at timestamptz not null default now()
);
alter table private.profiles enable row level security;
alter table private.user_roles enable row level security;
alter table private.assets enable row level security;
alter table private.characters enable row level security;
alter table private.categories enable row level security;
alter table private.sources enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;
insert into private.characters(stable_key,name,order_index) values ('rami','Rami',1),('beatriz','Beatriz',2),('leo','Leo',3),('dmitri','Dmitri',4),('naoki','Naoki',5),('salma','Salma',6),('tove','Tove',7),('kavya','Kavya',8);
insert into private.categories(name,slug) values ('Política','politica'),('Economía','economia'),('Tecnología','tecnologia'),('Ciencia','ciencia'),('Sociedad','sociedad'),('Cultura','cultura');
create function api.list_characters() returns table(stable_key text,name text,order_index smallint)
language sql stable security definer set search_path = '' as $$
 select c.stable_key,c.name,c.order_index from private.characters c where c.is_active order by c.order_index;
$$;
revoke all on function api.list_characters() from public;
grant execute on function api.list_characters() to anon,authenticated;
create function api.list_categories() returns table(name text,slug text)
language sql stable security definer set search_path = '' as $$
 select c.name,c.slug from private.categories c where c.is_active order by c.name;
$$;
revoke all on function api.list_categories() from public;
grant execute on function api.list_categories() to anon,authenticated;

