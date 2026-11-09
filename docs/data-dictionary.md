# Diccionario de datos Z01

Fuente de verdad: migraciones 20261108010000_catalogos.sql y 20261108020000_catalog_reader.sql. Todos los campos no indicados como opcionales son NOT NULL. Timestamps son timestamptz UTC. Datos de perfil son privados y se eliminan por cascada al eliminar el usuario Auth; la política completa de baja se implementará en Z11.

## private.profiles
- id uuid PK, FK auth.users(id), ON DELETE CASCADE; identidad, dato personal.
- alias text opcional, 1–40 caracteres no vacíos; dato personal.
- avatar_asset_id uuid opcional, FK assets, ON DELETE SET NULL.
- account_status text active/deletion_pending, default active; appearance text system/light/dark, default system.
- locale text es; timezone text default UTC; hide_confirmation boolean default false. La validación IANA se implementará al crear el endpoint en Z04.
- created_at y updated_at timestamptz default now(); la actualización automática de updated_at se implementará al introducir escrituras en Z04.

## private.user_roles
- user_id uuid FK profiles ON DELETE CASCADE; role text user/editor/admin; PK compuesta; created_at timestamptz. No se crea ningún usuario ni se conceden roles reales en Z01.

## private.assets
- id uuid PK default gen_random_uuid; path, mime_type, version text; sha256 text de 64 caracteres hexadecimales minúsculos; validation_status provisional/approved.
- owner_id uuid opcional FK profiles ON DELETE SET NULL; attribution y license text opcionales; created_at timestamptz. Los activos visuales reales y sus licencias aún no se han importado.

## private.characters
- id uuid PK; stable_key text UNIQUE; name text; order_index smallint UNIQUE; CHECK limita a las ocho combinaciones canónicas.
- biography text, traits text[] y portrait_asset_id uuid FK assets son opcionales hasta su validación editorial; FK ON DELETE SET NULL. canon_version text default V3.1; is_active boolean default true; created_at timestamptz.

## private.categories
- id uuid PK; name text único 1–80 caracteres no vacíos; slug text único con letras minúsculas ASCII, números y guiones internos; is_active boolean default true; created_at/updated_at timestamptz.

## private.sources
- id uuid PK; name/domain/base_url text; base_url validada inicialmente como HTTP/HTTPS; source_type rss/atom/api/manual; verified e is_active boolean; usage_policy text opcional; fetch_interval_minutes entero positivo default 30; last_fetched_at opcional; created_at timestamptz. La validación de red y SSRF corresponde a Z09.

## Funciones públicas
api.list_characters() devuelve stable_key, name y order_index ordenados; api.list_categories() devuelve name y slug de categorías activas. El rol riuya_catalog_reader es NOLOGIN, no superusuario y sin BYPASSRLS; solo tiene SELECT de los dos catálogos mediante políticas RLS. Las tablas privadas no se conceden a anon/authenticated. No se ha probado aún una sesión JWT real; esa integración corresponde a Z04.
