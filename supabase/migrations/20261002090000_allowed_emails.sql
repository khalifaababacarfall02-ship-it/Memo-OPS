-- Sign-up allow-list by exact address, next to the domain list. Lets one person in
-- (e.g. a founder's personal address) without opening a whole provider such as
-- proton.me or gmail.com to everyone. Idempotent: create if not exists + create or
-- replace (keeps the function's owner and grants).
--
-- Who may sign up = email domain in private.allowed_email_domains
--                OR exact address in private.allowed_emails.
-- Tests: supabase/tests/07_allowed_emails.test.sql.

create table if not exists private.allowed_emails (
  email text primary key
    constraint allowed_emails_email_format
    check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);
comment on table private.allowed_emails is
  'Exact lower-case addresses allowed to sign up, in addition to private.allowed_email_domains.';

alter table private.allowed_emails enable row level security;
revoke all on table private.allowed_emails from public, anon, authenticated, service_role;

-- Same signature and name as before (the auth.users triggers call it); now also
-- accepts an exact address from private.allowed_emails. Fails closed as before.
create or replace function private.email_domain_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(btrim(p_email) ~ '^[^@\s]+@[^@\s]+$', false)
     and (
       exists (
         select 1 from private.allowed_email_domains d
         where d.domain = lower(split_part(btrim(p_email), '@', 2))
       )
       or exists (
         select 1 from private.allowed_emails e
         where e.email = lower(btrim(p_email))
       )
     );
$$;
