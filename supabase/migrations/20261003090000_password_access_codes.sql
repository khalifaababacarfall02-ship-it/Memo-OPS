-- Sign-in with a password, without any email. An admin gives each person a one-time
-- access code (when inviting them, or when they forgot their password); with their
-- address and that code, the person chooses their password; then they sign in with
-- address + password (Supabase Auth, signInWithPassword).
-- Only additions and create or replace.
--
-- 1. private.access_codes: one pending code per address, stored as a bcrypt hash,
--    valid 7 days, locked after 5 wrong tries.
-- 2. public.issue_access_code(email): admins only; returns the code once (shown on /team).
-- 3. public.set_password_with_code(email, code, password): callable without a session.
--    Checks the code, then creates the Supabase Auth user (confirmed, with an email
--    identity) or changes the password of the existing one, and burns the code.
--    Returns a status instead of raising, so a wrong try is counted:
--      'ok' | 'invalid' (unknown address or wrong code) | 'expired' | 'locked' | 'weak'
--
-- The auth.users rows are written the way Supabase Auth writes them (bcrypt cost 10,
-- empty token columns, aud/role 'authenticated', an 'email' identity), so
-- signInWithPassword accepts them. The existing auth.users triggers still apply: the
-- address must be invited (or on an allowed domain), and the profile is created.
-- Tests: supabase/tests/10_access_codes.test.sql.

create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- 1. Codes
-- =====================================================================

create table if not exists private.access_codes (
  email text primary key
    constraint access_codes_email_format
    check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table private.access_codes is
  'One pending access code per address (bcrypt hash), to choose or reset a password. Written by issue_access_code(), burnt by set_password_with_code().';

alter table private.access_codes enable row level security;
revoke all on table private.access_codes from public, anon, authenticated, service_role;

-- =====================================================================
-- 2. Admins issue a code
-- =====================================================================

-- 8 characters without look-alikes (no 0/O, 1/I/L), shown as XXXX-XXXX: about 2^40
-- possibilities, and 5 tries per code.
create or replace function public.issue_access_code(p_email text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_raw text := '';
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'only an admin can give an access code' using errcode = '42501';
  end if;
  if not (private.email_domain_allowed(v_email)
          or exists (select 1 from public.profiles p where p.email = v_email)) then
    raise exception 'invite this address first' using errcode = '23514';
  end if;
  for i in 0..7 loop
    v_raw := v_raw || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  insert into private.access_codes (email, code_hash, expires_at, attempts, created_by, created_at)
  values (v_email, extensions.crypt(v_raw, extensions.gen_salt('bf', 8)), now() + interval '7 days', 0, auth.uid(), now())
  on conflict (email) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
        created_by = excluded.created_by, created_at = excluded.created_at;
  return substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4);
end;
$$;

-- =====================================================================
-- 3. The person chooses their password
-- =====================================================================

create or replace function public.set_password_with_code(p_email text, p_code text, p_password text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row private.access_codes;
  v_user uuid;
  v_hash text;
begin
  if p_password is null or char_length(p_password) < 8 or octet_length(p_password) > 72 then
    return 'weak';
  end if;

  select * into v_row from private.access_codes where email = v_email for update;
  if not found then
    return 'invalid';
  end if;
  if v_row.attempts >= 5 then
    return 'locked';
  end if;
  if v_row.expires_at < now() then
    return 'expired';
  end if;
  if char_length(v_code) <> 8 or extensions.crypt(v_code, v_row.code_hash) <> v_row.code_hash then
    update private.access_codes set attempts = attempts + 1 where email = v_email;
    return 'invalid';
  end if;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  select u.id into v_user
  from auth.users u
  where lower(u.email) = v_email and not u.is_sso_user
  order by u.created_at
  limit 1;

  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email, v_hash, now(),
      '', '', '', '',
      '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now()
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  else
    update auth.users
    set encrypted_password = v_hash,
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_user;
    -- An account made by an email link has no email identity row only in old projects;
    -- make sure password sign-in finds one.
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    select v_user::text, v_user,
           jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
           'email', now(), now(), now()
    where not exists (select 1 from auth.identities i where i.user_id = v_user and i.provider = 'email');
  end if;

  delete from private.access_codes where email = v_email;
  return 'ok';
end;
$$;

-- =====================================================================
-- 4. Privileges
-- =====================================================================

revoke all on function public.issue_access_code(text) from public, anon, authenticated, service_role;
grant execute on function public.issue_access_code(text) to authenticated;

revoke all on function public.set_password_with_code(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_password_with_code(text, text, text) to anon, authenticated;

-- The login page no longer asks "may this address sign in?" before sending an email
-- (there is no email any more): nobody needs to call can_sign_in() through the API.
revoke execute on function public.can_sign_in(text) from anon, authenticated;
