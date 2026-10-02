-- Stand-in for what a Supabase database already has before our migrations run,
-- so scripts/db-test.sh can test them on a plain Postgres (no Docker, no CLI).
-- Never run this on Supabase: there, Supabase Auth owns the `auth` schema.
--
-- Mimics:
--   * the API roles: anon, authenticated, service_role (bypassrls), authenticator,
--     and supabase_auth_admin (the role Supabase Auth connects as);
--   * schema auth with a reduced auth.users table and auth.uid() / auth.role() /
--     auth.email() / auth.jwt(), which read request.jwt.claims exactly like Supabase;
--   * schema extensions and the usage grants Supabase gives on it;
--   * Supabase's default privileges in public (new tables and functions are granted
--     to anon, authenticated and service_role), so the tests prove that the
--     migration's explicit revokes and grants are what decides access.

-- ---------- roles (cluster-wide, so created only once per server) ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- ---------- schema auth ----------
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;

-- The columns our triggers and tests use, with Supabase's types. Supabase's real
-- table has more (all nullable or defaulted) and no default on id: tests always
-- pass an explicit id so they run unchanged under `supabase test db`.
create table if not exists auth.users (
  instance_id uuid,
  id uuid not null primary key default gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table auth.users owner to supabase_auth_admin;
create unique index if not exists users_email_partial_key on auth.users (email) where (is_sso_user = false);
-- Password sign-in columns (written by public.set_password_with_code like Supabase Auth does).
alter table auth.users
  add column if not exists encrypted_password varchar(255),
  add column if not exists confirmation_token varchar(255),
  add column if not exists recovery_token varchar(255),
  add column if not exists email_change_token_new varchar(255),
  add column if not exists email_change varchar(255),
  add column if not exists last_sign_in_at timestamptz;

-- Same shape as Supabase's auth.identities (email is generated from identity_data).
create table if not exists auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid not null default gen_random_uuid() primary key,
  constraint identities_provider_id_provider_unique unique (provider_id, provider)
);
alter table auth.identities owner to supabase_auth_admin;

-- Same bodies as Supabase's auth functions: the JWT claims arrive in the
-- transaction-local setting request.jwt.claims (PostgREST sets it per request).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;
grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to anon, authenticated, service_role;

-- ---------- schema extensions ----------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------- public: Supabase's grants and default privileges ----------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Supabase puts `extensions` on the search path, which is where pgTAP lives.
do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end
$$;
