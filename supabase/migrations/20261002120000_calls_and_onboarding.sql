-- Calls round: invitations managed in the app, first sign-in (name + pôle), the people
-- of a memo's call, the call itself, and each person's private calendar link.
-- Only additions, create or replace and alter policy: nothing is dropped.
--
-- 1. public.invitations: who may sign in, managed by admins on /team (BoxHero uses
--    personal Gmail / Proton addresses, so there is no company domain to allow). An
--    invitation may carry a pôle: the person starts in it.
-- 2. public.can_sign_in(email): the login form's check, before any email is sent.
-- 3. profiles.onboarded_at + public.complete_onboarding(): the first sign-in asks the
--    person's name, and their pôle when nobody gave them one.
-- 4. public.memo_participants: the people of the call, by email (they may not have
--    signed in yet). They read the memo, like its decision maker.
-- 5. public.memo_calls: when the call is, and the calendar event it comes from.
-- 6. public.calendar_links: each person's secret calendar address (iCal), read by the
--    server to show their next calls. Only its owner reads or writes it.
-- 7. public.create_call_memo(): a memo prepared from a calendar event, in one go.
--
-- Errors raised here:
--   42501  not signed in
--   23514  a name is required
--   23514  a pôle is required
--   23514  too many participants
-- Tests: supabase/tests/08_invitations_onboarding.test.sql, 09_calls.test.sql.

-- =====================================================================
-- 1. Invitations
-- =====================================================================

create table if not exists public.invitations (
  email text primary key
    constraint invitations_email_format
    check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  -- The pôle the person starts in; null: they choose it at their first sign-in.
  team public.team_key
    constraint invitations_team_not_mini check (team is distinct from 'mini'),
  invited_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.invitations is
  'Addresses allowed to sign in, managed by admins on /team, with an optional starting pôle. Removing one blocks a person who never signed in; someone already in keeps signing in (take away their teams on /team).';

alter table public.invitations enable row level security;

create policy invitations_admin on public.invitations
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on table public.invitations from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.invitations to authenticated;
grant all on table public.invitations to service_role;

-- The addresses allowed until now (SQL only) become visible invitations.
insert into public.invitations (email, invited_by)
select e.email, null from private.allowed_emails e
on conflict (email) do nothing;

-- Same name and signature (the auth.users triggers call it): domains, exact addresses,
-- and now invitations.
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
       or exists (
         select 1 from public.invitations i
         where i.email = lower(btrim(p_email))
       )
     );
$$;

-- A new user also starts in the pôle of their invitation.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.email));
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(v_meta ->> 'full_name'), ''),
    nullif(btrim(v_meta ->> 'name'), ''),
    split_part(v_email, '@', 1)
  );
  insert into public.profiles (id, email, full_name, is_admin)
  values (
    new.id,
    v_email,
    left(v_name, 120),
    exists (select 1 from private.bootstrap_admins b where b.email = v_email)
  )
  on conflict (id) do nothing;

  insert into public.team_members (user_id, team)
  select new.id, i.team from public.invitations i
  where i.email = v_email and i.team is not null
  on conflict do nothing;
  return new;
end;
$$;

-- =====================================================================
-- 2. The login form's check
-- =====================================================================

-- True for an address that may sign up (domain, address or invitation) or that already
-- has an account. Callable without a session: it only answers yes or no for one address.
create or replace function public.can_sign_in(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.email_domain_allowed(p_email)
      or exists (select 1 from public.profiles p where p.email = lower(btrim(coalesce(p_email, ''))));
$$;

-- =====================================================================
-- 3. First sign-in
-- =====================================================================

alter table public.profiles add column if not exists onboarded_at timestamptz;
comment on column public.profiles.onboarded_at is
  'Set by complete_onboarding() at the first sign-in (name, pôle). Null: /welcome is shown.';

-- The first sign-in: the person's name and, when they are in no pôle yet, the one they
-- choose (admins may skip it: they see every pôle). Once done it does nothing: later
-- changes are the name on /team and the pôles an admin sets there.
create or replace function public.complete_onboarding(p_full_name text, p_team public.team_key default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_full_name, ''));
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if v_profile.onboarded_at is not null then
    return;
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'a name is required' using errcode = '23514';
  end if;
  if not exists (select 1 from public.team_members tm where tm.user_id = v_uid) then
    if p_team is null or p_team = 'mini' then
      if not v_profile.is_admin then
        raise exception 'a pôle is required' using errcode = '23514';
      end if;
    else
      insert into public.team_members (user_id, team) values (v_uid, p_team) on conflict do nothing;
    end if;
  end if;
  update public.profiles set full_name = v_name, onboarded_at = now() where id = v_uid;
end;
$$;

-- =====================================================================
-- 4. The people of the call
-- =====================================================================

create table if not exists public.memo_participants (
  memo_id uuid not null references public.memos (id) on delete cascade,
  email text not null
    constraint memo_participants_email_format
    check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (memo_id, email)
);
comment on table public.memo_participants is
  'The people of a memo''s call, by email. They read the memo (and its answers) like its decision maker; the author (or an admin) adds and removes them.';

create index if not exists memo_participants_email_idx on public.memo_participants (email);

-- The memos whose call the caller is in. Used by the memos policy as an uncorrelated
-- subquery (once per statement).
create or replace function private.my_call_memos()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.memo_id
  from public.memo_participants mp
  where mp.email = (select p.email from public.profiles p where p.id = (select auth.uid()));
$$;

-- canEditContent() for the call: the author (or an admin) while the memo is a draft or
-- to decide.
create or replace function private.can_manage_call(p_memo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memos m
    where m.id = p_memo_id
      and m.status in ('draft', 'to_decide')
      and (m.author_id = (select auth.uid()) or private.is_admin())
  );
$$;

-- Readers of a memo now include the people of its call.
create or replace function private.can_read_memo(p_memo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memos m
    where m.id = p_memo_id
      and (
        m.author_id = (select auth.uid())
        or m.decider_id = (select auth.uid())
        or private.is_admin()
        or private.is_team_member(m.team)
        or m.id in (select private.my_call_memos())
      )
  );
$$;

alter policy memos_select on public.memos
  using (
    author_id = (select auth.uid())
    or decider_id = (select auth.uid())
    or (select private.is_admin())
    or team in (select private.my_teams())
    or id in (select private.my_call_memos())
  );

-- At most 50 people per call (a typo loop must not fill the table).
create or replace function private.memo_participants_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.memo_participants mp where mp.memo_id = new.memo_id) >= 50 then
    raise exception 'too many participants' using errcode = '23514';
  end if;
  if auth.uid() is not null then
    new.added_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger memo_participants_guard
  before insert on public.memo_participants
  for each row execute function private.memo_participants_guard();

alter table public.memo_participants enable row level security;

create policy memo_participants_select on public.memo_participants
  for select to authenticated
  using (private.can_read_memo(memo_id));

create policy memo_participants_insert on public.memo_participants
  for insert to authenticated
  with check (private.can_manage_call(memo_id));

create policy memo_participants_delete on public.memo_participants
  for delete to authenticated
  using (private.can_manage_call(memo_id));

revoke all on table public.memo_participants from public, anon, authenticated, service_role;
grant select, insert, delete on table public.memo_participants to authenticated;
grant all on table public.memo_participants to service_role;

-- =====================================================================
-- 5. The call
-- =====================================================================

-- Kept out of public.memos: changing the call must not bump the memo's updated_at
-- (the editor's change detection).
create table if not exists public.memo_calls (
  memo_id uuid primary key references public.memos (id) on delete cascade,
  starts_at timestamptz,
  -- The calendar event it was prepared from (iCal UID, plus the occurrence for a
  -- repeating event): the home page links the event to its memo.
  event_id text
    constraint memo_calls_event_id_length check (char_length(event_id) between 1 and 1024),
  updated_at timestamptz not null default now()
);
comment on table public.memo_calls is
  'When a memo''s call is, and the calendar event it was prepared from. Same rights as memo_participants.';

create index if not exists memo_calls_starts_at_idx on public.memo_calls (starts_at);
create index if not exists memo_calls_event_id_idx on public.memo_calls (event_id);

create or replace function private.memo_calls_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger memo_calls_touch
  before insert or update on public.memo_calls
  for each row execute function private.memo_calls_touch();

alter table public.memo_calls enable row level security;

create policy memo_calls_select on public.memo_calls
  for select to authenticated
  using (private.can_read_memo(memo_id));

create policy memo_calls_insert on public.memo_calls
  for insert to authenticated
  with check (private.can_manage_call(memo_id));

create policy memo_calls_update on public.memo_calls
  for update to authenticated
  using (private.can_manage_call(memo_id))
  with check (private.can_manage_call(memo_id));

create policy memo_calls_delete on public.memo_calls
  for delete to authenticated
  using (private.can_manage_call(memo_id));

revoke all on table public.memo_calls from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.memo_calls to authenticated;
grant all on table public.memo_calls to service_role;

-- =====================================================================
-- 6. Calendar links
-- =====================================================================

create table if not exists public.calendar_links (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  -- A secret address: whoever has it reads the calendar. Never shown to anyone else.
  url text not null
    constraint calendar_links_url_format check (url ~ '^https://[^\s]+$' and char_length(url) <= 2048),
  updated_at timestamptz not null default now()
);
comment on table public.calendar_links is
  'Each person''s secret calendar address (iCal), read by the server to list their next calls. Only its owner reads or writes it, admins included.';

create trigger calendar_links_touch
  before insert or update on public.calendar_links
  for each row execute function private.memo_calls_touch();

alter table public.calendar_links enable row level security;

create policy calendar_links_own on public.calendar_links
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.calendar_links from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.calendar_links to authenticated;
grant all on table public.calendar_links to service_role;

-- =====================================================================
-- 7. A memo prepared from a calendar event
-- =====================================================================

-- Creates the memo, its call and its people in one transaction, as the caller (RLS and
-- the guard triggers apply). The caller's own memo for the same event is reused instead.
-- Returns the memo id.
create or replace function public.create_call_memo(
  p_team public.team_key,
  p_lang public.memo_lang,
  p_title text,
  p_content jsonb,
  p_starts_at timestamptz,
  p_event_id text,
  p_emails text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_event_id is not null then
    select m.id into v_id
    from public.memos m
    join public.memo_calls c on c.memo_id = m.id
    where c.event_id = p_event_id and m.author_id = v_uid and m.status <> 'archived'
    order by m.created_at
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.memos (team, lang, title, content)
  values (p_team, p_lang, left(coalesce(p_title, ''), 300), coalesce(p_content, '{}'::jsonb))
  returning id into v_id;

  insert into public.memo_calls (memo_id, starts_at, event_id)
  values (v_id, p_starts_at, p_event_id);

  insert into public.memo_participants (memo_id, email)
  select distinct v_id, lower(btrim(e))
  from unnest(coalesce(p_emails, '{}'::text[])) as e
  where lower(btrim(e)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and char_length(btrim(e)) <= 320
  limit 50;

  return v_id;
end;
$$;

-- =====================================================================
-- 8. Function privileges
-- =====================================================================

revoke all on function
  private.my_call_memos(),
  private.can_manage_call(uuid),
  private.memo_participants_guard(),
  private.memo_calls_touch()
  from public, anon, authenticated, service_role;
grant execute on function private.my_call_memos(), private.can_manage_call(uuid) to authenticated;

revoke all on function public.can_sign_in(text) from public, anon, authenticated, service_role;
grant execute on function public.can_sign_in(text) to anon, authenticated;

revoke all on function public.complete_onboarding(text, public.team_key) from public, anon, authenticated, service_role;
grant execute on function public.complete_onboarding(text, public.team_key) to authenticated;

revoke all on function public.create_call_memo(public.team_key, public.memo_lang, text, jsonb, timestamptz, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_call_memo(public.team_key, public.memo_lang, text, jsonb, timestamptz, text, text[])
  to authenticated;
