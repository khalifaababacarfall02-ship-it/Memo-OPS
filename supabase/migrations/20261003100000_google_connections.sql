-- Google Calendar, connected in one click (OAuth): each person's Google account and the
-- refresh token that lets the server read their next events. The token is stored
-- encrypted with a key only the server has (GOOGLE_TOKEN_KEY, AES-256-GCM): what the
-- row holds is useless without it, even to its owner's browser.
-- Only its owner reads or writes the row (admins included cannot).
-- Tests: supabase/tests/11_google_connections.test.sql.

create table if not exists public.google_connections (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  google_email text not null
    constraint google_connections_email_format check (google_email ~ '^[^@\s]+@[^@\s]+$' and char_length(google_email) <= 320),
  -- "v1.<iv>.<tag>.<ciphertext>" (base64url), see src/lib/google/crypto.ts.
  refresh_token text not null
    constraint google_connections_token_format check (refresh_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and char_length(refresh_token) <= 4096),
  scope text not null default ''
    constraint google_connections_scope_length check (char_length(scope) <= 2048),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.google_connections is
  'Each person''s Google Calendar connection: their Google address and an encrypted refresh token (key on the server only). Owner only.';

create trigger google_connections_touch
  before insert or update on public.google_connections
  for each row execute function private.memo_calls_touch();

alter table public.google_connections enable row level security;

create policy google_connections_own on public.google_connections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.google_connections from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.google_connections to authenticated;
grant all on table public.google_connections to service_role;
