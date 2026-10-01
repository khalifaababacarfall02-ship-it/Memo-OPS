-- BoxHero memo app: data model, row level security, workflow guard, sign-up restriction.
--
-- Contract: docs/ARCHITECTURE.md §2. The workflow rules mirror canTransition,
-- canEditContent, canAnswer and canDelete in src/lib/memo/model.ts: change both together.
-- Tests: supabase/tests/*.test.sql (run with `npm run db:test` or `supabase test db`).
--
-- Targets hosted Supabase (Postgres 15/17; Supabase Auth owns schema auth). Also runs on a
-- plain Postgres that has the stand-in from scripts/sql/auth-stub.sql.
--
-- Trusted callers: when auth.uid() is null (service role key, SQL editor, migrations,
-- Supabase Auth itself) the guard triggers let every change through. Signed-in users
-- always have auth.uid(), and RLS already stops anything without it.
--
-- Errors raised here (the app maps them; PostgREST returns them as { code, message }):
--   42501  email domain not allowed                              (auth.users insert / email change)
--   42501  memo column <id|team|author_id|created_at> cannot be changed
--   42501  only the author can edit this memo
--   42501  memo is locked once decided or archived
--   42501  memo status change not allowed: <from> -> <to>
--   23514  a memo to decide needs a decision maker and a title
--   42501  only the decision maker can answer, while the memo is to decide
--   42501  answer memo_id and question_id cannot be changed
--   23503  question not found in this memo
--   42501  profile id cannot be changed
--   42501  profile email follows the sign-in email and cannot be changed
--   42501  only an admin can change admin rights
--   42501  cannot remove the last admin

-- =====================================================================
-- 1. Extensions and schemas
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Helper and trigger functions and configuration tables. Not exposed by the Data API
-- (only `public` is). Signed-in users may call the RLS helpers (section 5), nothing else.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- =====================================================================
-- 2. Types
-- =====================================================================

-- The six pills; `mini` is the ad mini memo.
create type public.team_key as enum ('ops', 'growth', 'crea', 'sav', 'finance', 'mini');
create type public.memo_lang as enum ('fr', 'en');
create type public.memo_status as enum ('draft', 'to_decide', 'decided', 'archived');

-- =====================================================================
-- 3. Configuration (private): who may sign up, who starts as admin
-- =====================================================================

create table private.allowed_email_domains (
  domain text primary key
    constraint allowed_email_domains_domain_format
    check (
      domain = lower(domain)
      and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    ),
  created_at timestamptz not null default now()
);
comment on table private.allowed_email_domains is
  'Email domains allowed to sign up, lower case (e.g. boxhero.com). Empty table = nobody can sign up.';

create table private.bootstrap_admins (
  email text primary key
    constraint bootstrap_admins_email_format
    check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);
comment on table private.bootstrap_admins is
  'Lower-case emails whose profile gets is_admin = true when created (or right away if it already exists).';

-- Only the owner (migrations, SQL editor) touches these; the functions below read
-- them as security definer. RLS without policies is a second lock.
alter table private.allowed_email_domains enable row level security;
alter table private.bootstrap_admins enable row level security;
revoke all on table private.allowed_email_domains, private.bootstrap_admins
  from public, anon, authenticated, service_role;

-- =====================================================================
-- 4. Tables
-- =====================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null
    constraint profiles_email_format check (email = lower(email) and email <> ''),
  full_name text not null default ''
    constraint profiles_full_name_length check (char_length(full_name) <= 120),
  is_admin boolean not null default false,
  asana_user_gid text
    constraint profiles_asana_user_gid_format check (asana_user_gid ~ '^[0-9]{1,32}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is
  'One row per auth user, created by a trigger on auth.users. Read by every signed-in user.';

create table public.team_members (
  user_id uuid not null references public.profiles (id) on delete cascade,
  team public.team_key not null,
  created_at timestamptz not null default now(),
  primary key (user_id, team)
);
comment on table public.team_members is 'Team membership: members read every memo of their team. Admins manage it.';

create index team_members_team_idx on public.team_members (team);

-- Authors and people who answered cannot be deleted while their memos/answers exist
-- (restrict): remove access with team_members / a ban instead. A deleted decision
-- maker is cleared from the memos (set null) and the author picks another one.
create table public.memos (
  id uuid primary key default gen_random_uuid(),
  team public.team_key not null,
  lang public.memo_lang not null,
  title text not null default ''
    constraint memos_title_length check (char_length(title) <= 300),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  decider_id uuid references public.profiles (id) on delete set null,
  status public.memo_status not null default 'draft',
  -- The document without the title (src/lib/memo/model.ts: MemoContent).
  content jsonb not null default '{}'::jsonb
    constraint memos_content_object check (jsonb_typeof(content) = 'object')
    constraint memos_content_size check (pg_column_size(content) <= 262144),
  asana_task_gid text
    constraint memos_asana_task_gid_format check (asana_task_gid ~ '^[0-9]{1,32}$'),
  -- Maintained by the memos_search_text trigger; never written by clients.
  search_text text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Archiving keeps decided_at (archived after a decision) or keeps it null.
  constraint memos_decided_at_matches_status check (
    (status = 'decided' and decided_at is not null)
    or (status in ('draft', 'to_decide') and decided_at is null)
    or status = 'archived'
  )
);
comment on table public.memos is
  'Decision memos. Visibility and workflow: see docs/ARCHITECTURE.md §2 and the memos_guard trigger.';
comment on column public.memos.search_text is
  'lower(unaccent(title + every string of content except "id" and "kind" values)), whitespace collapsed. Search it with ilike.';

create index memos_team_status_updated_idx on public.memos (team, status, updated_at desc);
create index memos_author_updated_idx on public.memos (author_id, updated_at desc);
create index memos_decider_status_idx on public.memos (decider_id, status);
create index memos_search_text_trgm_idx on public.memos using gin (search_text extensions.gin_trgm_ops);

-- Answers live outside memos.content so the author can never overwrite them.
create table public.memo_answers (
  memo_id uuid not null references public.memos (id) on delete cascade,
  -- The id of a question in memos.content->'qs'.
  question_id text not null
    constraint memo_answers_question_id_format check (question_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  answer text not null default ''
    constraint memo_answers_answer_length check (char_length(answer) <= 20000),
  answered_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (memo_id, question_id)
);
comment on table public.memo_answers is
  'The decision maker''s answer to each question of a memo, written while the memo is to decide.';

create index memo_answers_answered_by_idx on public.memo_answers (answered_by);

-- =====================================================================
-- 5. RLS helpers (private, security definer, called from policies)
-- =====================================================================

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create function private.is_team_member(p_team public.team_key)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.user_id = (select auth.uid()) and tm.team = p_team
  );
$$;

-- The caller's teams. The memos policy uses it as an uncorrelated subquery, so it
-- runs once per statement instead of once per row.
create function private.my_teams()
returns setof public.team_key
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team from public.team_members tm where tm.user_id = (select auth.uid());
$$;

create function private.can_read_memo(p_memo_id uuid)
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
      )
  );
$$;

-- Mirrors canAnswer(): the decision maker (or an admin) while the memo is to decide.
create function private.can_answer(p_memo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memos m
    where m.id = p_memo_id
      and m.status = 'to_decide'
      and (m.decider_id = (select auth.uid()) or private.is_admin())
  );
$$;

-- =====================================================================
-- 6. Search text
-- =====================================================================

-- Every string value in a JSON document, skipping the values of "id" and "kind" keys
-- (row ids and the memo kind would otherwise match almost any search).
create function private.jsonb_search_strings(p_doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  with recursive walk (key, value) as (
    select null::text, p_doc
    union all
    select child.key, child.value
    from walk
    cross join lateral (
      select o.key, o.value
      from jsonb_each(case when jsonb_typeof(walk.value) = 'object' then walk.value end) o
      union all
      select walk.key, a.value
      from jsonb_array_elements(case when jsonb_typeof(walk.value) = 'array' then walk.value end) a
    ) child
  )
  select coalesce(string_agg(walk.value #>> '{}', ' '), '')
  from walk
  where jsonb_typeof(walk.value) = 'string'
    and (walk.key is null or walk.key not in ('id', 'kind'));
$$;

-- unaccent first (É -> E), then lower: works whatever the database locale is.
-- The two-argument unaccent names its dictionary, so it works with an empty search_path.
create function private.memo_search_text(p_title text, p_content jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(extensions.unaccent(
      'extensions.unaccent'::regdictionary,
      coalesce(p_title, '') || ' ' || private.jsonb_search_strings(p_content)
    )),
    '\s+', ' ', 'g'
  ));
$$;

create function private.memos_search_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.title is distinct from old.title
     or new.content is distinct from old.content then
    new.search_text := private.memo_search_text(new.title, new.content);
  else
    new.search_text := old.search_text;
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 7. Guards (BEFORE triggers)
-- =====================================================================

-- memos: forced values on insert; column and status rules on update
-- (docs/ARCHITECTURE.md "Workflow guard").
create function private.memos_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_author boolean;
  v_decider boolean;
  v_allowed boolean;
begin
  if tg_op = 'INSERT' then
    if v_uid is null then
      -- Trusted import: keep the given status, make decided_at agree with it.
      if new.status = 'decided' then
        new.decided_at := coalesce(new.decided_at, now());
      elsif new.status in ('draft', 'to_decide') then
        new.decided_at := null;
      end if;
      return new;
    end if;
    -- A memo always starts as the caller's own draft.
    new.author_id := v_uid;
    new.status := 'draft';
    new.decided_at := null;
    new.asana_task_gid := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if v_uid is null then
    -- Trusted caller: keep explicit values, only keep the timestamps consistent.
    if new.updated_at is not distinct from old.updated_at then
      new.updated_at := now();
    end if;
    if new.status is distinct from old.status and new.decided_at is not distinct from old.decided_at then
      new.decided_at := case new.status
        when 'decided' then now()
        when 'archived' then old.decided_at
        else null
      end;
    end if;
    return new;
  end if;

  v_admin := private.is_admin();
  v_author := old.author_id = v_uid;
  v_decider := coalesce(old.decider_id = v_uid, false);

  if new.id is distinct from old.id then
    raise exception 'memo column id cannot be changed' using errcode = '42501';
  end if;
  if new.team is distinct from old.team then
    raise exception 'memo column team cannot be changed' using errcode = '42501';
  end if;
  if new.author_id is distinct from old.author_id then
    raise exception 'memo column author_id cannot be changed' using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'memo column created_at cannot be changed' using errcode = '42501';
  end if;

  -- canEditContent(): the author (or an admin) while draft or to decide.
  if new.title is distinct from old.title
     or new.content is distinct from old.content
     or new.lang is distinct from old.lang
     or new.decider_id is distinct from old.decider_id then
    if not (v_author or v_admin) then
      raise exception 'only the author can edit this memo' using errcode = '42501';
    end if;
    if old.status not in ('draft', 'to_decide') then
      raise exception 'memo is locked once decided or archived' using errcode = '42501';
    end if;
  end if;

  -- canTransition(): the six transitions of TRANSITIONS; admins may do any of them.
  if new.status is distinct from old.status then
    v_allowed := case
      when old.status = 'draft' and new.status = 'to_decide' then v_author or v_admin          -- submit
      when old.status = 'to_decide' and new.status = 'draft' then v_author or v_admin          -- withdraw
      when old.status = 'to_decide' and new.status = 'decided' then v_decider or v_admin       -- decide
      when old.status = 'decided' and new.status = 'to_decide' then v_decider or v_admin       -- reopen
      when old.status in ('draft', 'to_decide', 'decided') and new.status = 'archived'
        then v_author or v_decider or v_admin                                                  -- archive
      when old.status = 'archived' and new.status = 'draft' then v_author or v_admin           -- restore
      else false
    end;
    if not v_allowed then
      raise exception 'memo status change not allowed: % -> %', old.status, new.status
        using errcode = '42501';
    end if;
    new.decided_at := case new.status
      when 'decided' then now()
      when 'archived' then old.decided_at
      else null
    end;
  else
    new.decided_at := old.decided_at;
  end if;

  -- Someone must be able to decide: checked when a memo becomes to decide, and when
  -- its title or decision maker changes while it is.
  if new.status = 'to_decide'
     and (new.status is distinct from old.status
          or new.title is distinct from old.title
          or new.decider_id is distinct from old.decider_id)
     and (new.decider_id is null or btrim(new.title) = '') then
    raise exception 'a memo to decide needs a decision maker and a title' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- memo_answers: only the decision maker (or an admin) while to decide; answered_by is
-- always the caller; the question must exist in the memo.
create function private.memo_answers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    if tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
      new.updated_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (new.memo_id is distinct from old.memo_id or new.question_id is distinct from old.question_id) then
    raise exception 'answer memo_id and question_id cannot be changed' using errcode = '42501';
  end if;

  -- Checked here (before RLS) to give a clear message instead of the generic RLS one.
  if not private.can_answer(new.memo_id) then
    raise exception 'only the decision maker can answer, while the memo is to decide'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.memos m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m.content -> 'qs') = 'array' then m.content -> 'qs' else '[]'::jsonb end
    ) q
    where m.id = new.memo_id and q ->> 'id' = new.question_id
  ) then
    raise exception 'question not found in this memo' using errcode = '23503';
  end if;

  new.answered_by := v_uid;
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- profiles: id immutable, email mirrors auth.users, only admins change is_admin and
-- at least one admin remains.
create function private.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    if new.updated_at is not distinct from old.updated_at then
      new.updated_at := now();
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'profile id cannot be changed' using errcode = '42501';
  end if;

  -- The only accepted email change is the sync from auth.users (see below).
  if new.email is distinct from old.email
     and new.email is distinct from (select lower(btrim(u.email)) from auth.users u where u.id = new.id) then
    raise exception 'profile email follows the sign-in email and cannot be changed' using errcode = '42501';
  end if;

  if new.is_admin is distinct from old.is_admin then
    if not private.is_admin() then
      raise exception 'only an admin can change admin rights' using errcode = '42501';
    end if;
    if not new.is_admin
       and not exists (select 1 from public.profiles p where p.is_admin and p.id <> old.id) then
      raise exception 'cannot remove the last admin' using errcode = '42501';
    end if;
  end if;

  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
-- 8. Sign-up restriction and profile creation (triggers on auth.users)
-- =====================================================================

-- True when the email has exactly one @ and its domain is in allowed_email_domains
-- (case-insensitive). Fails closed: null email, odd format or empty table = false.
create function private.email_domain_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(btrim(p_email) ~ '^[^@\s]+@[^@\s]+$', false)
     and exists (
       select 1 from private.allowed_email_domains d
       where d.domain = lower(split_part(btrim(p_email), '@', 2))
     );
$$;

create function private.check_auth_user_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.email_domain_allowed(new.email) then
    raise exception 'email domain not allowed'
      using errcode = '42501',
            detail = format('Sign-up is limited to the domains in private.allowed_email_domains (got %L).',
                            split_part(coalesce(new.email, ''), '@', 2));
  end if;
  return new;
end;
$$;

create function private.handle_new_auth_user()
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
  return new;
end;
$$;

create function private.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(btrim(new.email)) where id = new.id;
  return new;
end;
$$;

-- A bootstrap admin added after the person first signed in is promoted right away.
create function private.handle_bootstrap_admin_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set is_admin = true where email = new.email and not is_admin;
  return new;
end;
$$;

-- =====================================================================
-- 9. Triggers
-- =====================================================================

create trigger profiles_guard
  before update on public.profiles
  for each row execute function private.profiles_guard();

-- Fires before memos_search_text (same timing, alphabetical order).
create trigger memos_guard
  before insert or update on public.memos
  for each row execute function private.memos_guard();

create trigger memos_search_text
  before insert or update on public.memos
  for each row execute function private.memos_search_text();

create trigger memo_answers_guard
  before insert or update on public.memo_answers
  for each row execute function private.memo_answers_guard();

create trigger on_auth_user_check_email_domain
  before insert on auth.users
  for each row execute function private.check_auth_user_email_domain();

-- Only real changes: existing users keep signing in if a domain is later removed.
create trigger on_auth_user_check_email_domain_update
  before update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function private.check_auth_user_email_domain();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function private.handle_auth_user_email_change();

create trigger on_bootstrap_admin_added
  after insert on private.bootstrap_admins
  for each row execute function private.handle_bootstrap_admin_added();

-- =====================================================================
-- 10. Row level security
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.team_members enable row level security;
alter table public.memos enable row level security;
alter table public.memo_answers enable row level security;

-- profiles: everyone signed in reads (to pick a decision maker); a user updates their
-- own row, admins any row (profiles_guard decides which columns). No insert/delete.
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

-- team_members: everyone signed in reads; only admins add or remove.
create policy team_members_select on public.team_members
  for select to authenticated
  using (true);

create policy team_members_insert on public.team_members
  for insert to authenticated
  with check ((select private.is_admin()));

create policy team_members_delete on public.team_members
  for delete to authenticated
  using ((select private.is_admin()));

-- memos: read if author, decision maker, admin or member of the memo's team.
create policy memos_select on public.memos
  for select to authenticated
  using (
    author_id = (select auth.uid())
    or decider_id = (select auth.uid())
    or (select private.is_admin())
    or team in (select private.my_teams())
  );

create policy memos_insert on public.memos
  for insert to authenticated
  with check (author_id = (select auth.uid()) and status = 'draft');

-- Who may update at all; memos_guard decides what each of them may change.
create policy memos_update on public.memos
  for update to authenticated
  using (
    author_id = (select auth.uid())
    or decider_id = (select auth.uid())
    or (select private.is_admin())
  )
  with check (
    author_id = (select auth.uid())
    or decider_id = (select auth.uid())
    or (select private.is_admin())
  );

-- canDelete(): the author while draft; admins any memo. Everything else is archived.
create policy memos_delete on public.memos
  for delete to authenticated
  using (
    (author_id = (select auth.uid()) and status = 'draft')
    or (select private.is_admin())
  );

-- memo_answers: read with the memo; written only through can_answer().
create policy memo_answers_select on public.memo_answers
  for select to authenticated
  using (private.can_read_memo(memo_id));

create policy memo_answers_insert on public.memo_answers
  for insert to authenticated
  with check (answered_by = (select auth.uid()) and private.can_answer(memo_id));

create policy memo_answers_update on public.memo_answers
  for update to authenticated
  using (private.can_answer(memo_id))
  with check (answered_by = (select auth.uid()) and private.can_answer(memo_id));

create policy memo_answers_delete on public.memo_answers
  for delete to authenticated
  using (private.can_answer(memo_id));

-- =====================================================================
-- 11. Privileges
-- =====================================================================
-- Explicit, so the result is the same with Supabase's default privileges (which grant
-- everything in public to anon, authenticated and service_role) and without them.

revoke all on table public.profiles, public.team_members, public.memos, public.memo_answers
  from public, anon, authenticated, service_role;

grant select, update on table public.profiles to authenticated;
grant select, insert, delete on table public.team_members to authenticated;
grant select, insert, update, delete on table public.memos to authenticated;
grant select, insert, update, delete on table public.memo_answers to authenticated;

grant all on table public.profiles, public.team_members, public.memos, public.memo_answers
  to service_role;

-- Functions: only the RLS helpers are callable, and only by signed-in users. Postgres
-- grants EXECUTE to PUBLIC on every new function (per-schema defaults cannot undo that),
-- so a later migration adding a function to private must revoke it the same way.
revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function
  private.is_admin(),
  private.is_team_member(public.team_key),
  private.my_teams(),
  private.can_read_memo(uuid),
  private.can_answer(uuid)
  to authenticated;
