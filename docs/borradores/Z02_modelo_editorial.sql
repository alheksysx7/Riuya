-- Z02: borradores editoriales y revisiones. No conceder acceso directo a clientes.
create table private.events (
 id uuid primary key default gen_random_uuid(), title text not null check (length(btrim(title)) between 1 and 300),
 created_at timestamptz not null default now()
);
create table private.articles (
 id uuid primary key default gen_random_uuid(), event_id uuid references private.events(id),
 category_id uuid not null references private.categories(id),
 status text not null default 'draft' check (status in ('draft','review','published','withdrawn')),
 version integer not null default 1 check (version > 0),
 current_revision_id uuid,
 created_by uuid references private.profiles(id) on delete set null,
 approved_by uuid references private.profiles(id) on delete set null,
 published_at timestamptz, withdrawn_at timestamptz,
 withdrawal_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (status not in ('published','withdrawn') or (published_at is not null and current_revision_id is not null)),
 check (status <> 'withdrawn' or (withdrawn_at is not null and length(btrim(withdrawal_reason)) > 0))
);
create table private.article_revisions (
 id uuid primary key default gen_random_uuid(), article_id uuid not null references private.articles(id),
 revision_number integer not null check (revision_number > 0), title text not null,
 micro_summary text not null, full_paragraphs jsonb not null check (jsonb_typeof(full_paragraphs)='array'),
 correction_note text, created_by uuid references private.profiles(id) on delete set null,
 created_at timestamptz not null default now(), unique(article_id,revision_number), unique(article_id,id)
);
alter table private.articles add constraint current_revision_belongs_to_article foreign key(id,current_revision_id) references private.article_revisions(article_id,id);
create table private.article_sources (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references private.article_revisions(id),
 citation_key text not null, source_name text not null, source_date date not null,
 url text not null check (url ~ '^https?://'), unique(revision_id,citation_key)
);
create table private.opinions (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references private.article_revisions(id),
 character_id uuid not null references private.characters(id), body text not null,
 unique(revision_id,character_id)
);
create table private.editorial_events (
 id uuid primary key default gen_random_uuid(), article_id uuid not null references private.articles(id),
 event_type text not null check (event_type in ('publish','correct','withdraw')),
 actor_id uuid references private.profiles(id) on delete set null, occurred_at timestamptz not null default now(), reason text
);
alter table private.events enable row level security;
alter table private.articles enable row level security;
alter table private.article_revisions enable row level security;
alter table private.article_sources enable row level security;
alter table private.opinions enable row level security;
alter table private.editorial_events enable row level security;
revoke all on private.events,private.articles,private.article_revisions,private.article_sources,private.opinions,private.editorial_events from public,anon,authenticated;
