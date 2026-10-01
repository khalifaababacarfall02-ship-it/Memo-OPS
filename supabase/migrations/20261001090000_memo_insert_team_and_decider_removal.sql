-- Fix round after the review of 20260928120000_memo_app.sql. Idempotent (drop policy if
-- exists + create, create or replace function), so it can be re-run safely.
--
-- 1. memos_insert: a signed-in user creates memos only in a team they belong to (admins:
--    any team). Before, any employee could create a memo in any team and send it to any
--    decision maker. The decision maker stays free (anyone may decide, and gets read
--    access to that memo as its decision maker: intended).
-- 2. memos_guard: when a decision maker is deleted (FK memos_decider_id_fkey, on delete
--    set null), a memo that was waiting for them goes back to draft instead of staying
--    "to decide" with nobody to decide (and refusing the author's edits).
-- 3. memos.asana_task_gid: residual risk documented (see the column comment).
--
-- Errors: unchanged. A refused insert is the generic RLS error
--   42501  new row violates row-level security policy for table "memos"
-- Tests: supabase/tests/02_memos_access.test.sql (insert), 06_decider_removal.test.sql.

-- =====================================================================
-- 1. Insert only into one's own teams
-- =====================================================================

drop policy if exists memos_insert on public.memos;
create policy memos_insert on public.memos
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'draft'
    and (team in (select private.my_teams()) or (select private.is_admin()))
  );

-- =====================================================================
-- 2. memos_guard: a deleted decision maker sends the memo back to draft
-- =====================================================================

-- Same function as in 20260928120000_memo_app.sql, plus the "decision maker removed"
-- rule at the top of the UPDATE branch. CREATE OR REPLACE keeps its owner and grants.
create or replace function private.memos_guard()
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

  -- The decision maker was deleted: the foreign key action (on delete set null) clears
  -- decider_id and changes nothing else. A memo waiting for them goes back to draft, so
  -- the author can edit it and pick someone else. FK actions run without a user (Auth
  -- admin API, dashboard, SQL editor); inside a signed-in session they are recognised as
  -- a nested statement (pg_trigger_depth() > 1) that only cleared decider_id: users can
  -- neither delete profiles nor run their own triggers, so they cannot fake one.
  if new.decider_id is null
     and old.decider_id is not null
     and old.status = 'to_decide'
     and new.status = 'to_decide'
     and (
       v_uid is null
       or (pg_trigger_depth() > 1
           and (to_jsonb(new) - 'decider_id') = (to_jsonb(old) - 'decider_id'))
     ) then
    new.status := 'draft';
    new.decided_at := null;
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

-- =====================================================================
-- 3. asana_task_gid: who may write it
-- =====================================================================

-- The app has no service-role key, so POST /api/asana saves the gid as the signed-in
-- person, through RLS: anyone who may update the memo (author, decision maker, admin)
-- can also write any numeric gid here through the API. The route therefore never trusts
-- it: it updates a stored task only after checking (with the server's Asana token) that
-- the task belongs to the Memos project, otherwise it creates a new one; and it saves a
-- new gid with a compare-and-set (only if the column still holds what it read), so two
-- simultaneous sends keep one task. Making the column server-only would need a
-- service-role key or a security definer RPC holding the Asana logic.
comment on column public.memos.asana_task_gid is
  'Asana task of the memo, written by POST /api/asana as the signed-in person (RLS). Also writable through the API by anyone who may update the memo: never trusted as is (the route checks the task is in the Memos project before updating it).';
