-- The memos_guard workflow: every status change for every role, who edits what and when,
-- immutable and derived columns. Mirrors canTransition / canEditContent in
-- src/lib/memo/model.ts.
begin;
-- pgTAP: installed by `supabase test db` and scripts/db-test.sh (possibly as plain SQL).
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(112);

-- ---------- helpers (rolled back with the transaction) ----------
create schema bxh_test;
grant usage on schema bxh_test to public;

create function bxh_test.uid(p_name text) returns uuid language plpgsql immutable as $$
begin
  return case p_name
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'author' then 'a0000000-0000-4000-8000-000000000002'
    when 'member' then 'a0000000-0000-4000-8000-000000000003'
    when 'decider' then 'a0000000-0000-4000-8000-000000000004'
    when 'outsider' then 'a0000000-0000-4000-8000-000000000005'
    when 'loner' then 'a0000000-0000-4000-8000-000000000006'
    else null
  end::uuid;
end $$;

create function bxh_test.memo(p_n int) returns uuid language sql immutable as $$
  select ('f0000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create procedure bxh_test.login(p_name text) language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', bxh_test.uid(p_name), 'role', 'authenticated')::text, true);
end $$;

create procedure bxh_test.login_role(p_role text) language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
end $$;

create procedure bxh_test.logout() language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;

-- Runs a statement as a user: 'ok' (a row changed), 'hidden' (RLS let no row through),
-- 'denied' (42501 from the guard) or the unexpected error. Call it as the runner.
create function bxh_test.attempt(p_user text, p_sql text) returns text language plpgsql as $$
declare
  v_rows int;
begin
  call bxh_test.login(p_user);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
  exception when others then
    call bxh_test.logout();
    return case when sqlstate = '42501' then 'denied' else sqlstate || ': ' || sqlerrm end;
  end;
  call bxh_test.logout();
  return case when v_rows = 0 then 'hidden' else 'ok' end;
end $$;

-- Puts memo 1 in p_from (as the trusted runner), then tries p_to as p_user.
create function bxh_test.try_status(p_user text, p_from text, p_to text) returns text language plpgsql as $$
begin
  update public.memos set status = p_from::public.memo_status where id = bxh_test.memo(1);
  return bxh_test.attempt(p_user,
    format('update public.memos set status = %L where id = %L', p_to, bxh_test.memo(1)));
end $$;

-- Puts memo 1 in p_status, then tries to edit its title as p_user.
create function bxh_test.try_edit(p_user text, p_status text) returns text language plpgsql as $$
begin
  update public.memos set status = p_status::public.memo_status, title = 'Matrix memo' where id = bxh_test.memo(1);
  return bxh_test.attempt(p_user,
    format('update public.memos set title = %L where id = %L', 'Edited by ' || p_user, bxh_test.memo(1)));
end $$;

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('admin'), 'pgtap.admin@boxhero.test'),        -- admin, no team
  (bxh_test.uid('author'), 'pgtap.author@boxhero.test'),      -- ops
  (bxh_test.uid('member'), 'pgtap.member@boxhero.test'),      -- ops
  (bxh_test.uid('decider'), 'pgtap.decider@boxhero.test'),    -- finance
  (bxh_test.uid('loner'), 'pgtap.loner@boxhero.test');        -- no team
insert into public.team_members (user_id, team) values
  (bxh_test.uid('author'), 'ops'),
  (bxh_test.uid('member'), 'ops'),
  (bxh_test.uid('decider'), 'finance');
insert into public.memos (id, team, lang, title, author_id, decider_id, content) values
  (bxh_test.memo(1), 'ops', 'fr', 'Matrix memo', bxh_test.uid('author'), bxh_test.uid('decider'),
   '{"kind": "memo", "qs": [{"id": "q1", "q": "Oui ou non ?"}]}'),
  (bxh_test.memo(2), 'ops', 'fr', 'Second memo', bxh_test.uid('author'), bxh_test.uid('decider'), '{}');

-- ---------- every status change x every role ----------
-- The six transitions of TRANSITIONS (archive has three sources) and the four pairs
-- that are no transition at all. Admins may do any real transition. Team members and
-- outsiders cannot update the memo at all: RLS hides it ('hidden').
select is(
  bxh_test.try_status(c.role, c.from_status, c.to_status),
  c.expected,
  format('%s: %s -> %s (%s) is %s', c.role, c.from_status, c.to_status, c.name, c.expected)
)
from (
select t.n as tn, r.n as rn, r.role, t.name, t.from_status, t.to_status,
  case
    when r.role in ('member', 'loner') then 'hidden'
    when r.role = 'admin' and t.name <> 'none' then 'ok'
    when r.role = any (t.allowed) then 'ok'
    else 'denied'
  end as expected
from (values
  (1, 'submit', 'draft', 'to_decide', array['author']),
  (2, 'withdraw', 'to_decide', 'draft', array['author']),
  (3, 'decide', 'to_decide', 'decided', array['decider']),
  (4, 'reopen', 'decided', 'to_decide', array['decider']),
  (5, 'archive', 'draft', 'archived', array['author', 'decider']),
  (6, 'archive', 'to_decide', 'archived', array['author', 'decider']),
  (7, 'archive', 'decided', 'archived', array['author', 'decider']),
  (8, 'restore', 'archived', 'draft', array['author']),
  (9, 'none', 'draft', 'decided', array[]::text[]),
  (10, 'none', 'decided', 'draft', array[]::text[]),
  (11, 'none', 'archived', 'to_decide', array[]::text[]),
  (12, 'none', 'archived', 'decided', array[]::text[])
) as t (n, name, from_status, to_status, allowed)
cross join (values (1, 'author'), (2, 'decider'), (3, 'admin'), (4, 'member'), (5, 'loner')) as r (n, role)
) as c
order by c.tn, c.rn;

-- ---------- who edits the content, in which status ----------
select is(
  bxh_test.try_edit(c.role, c.status),
  c.expected,
  format('%s edits the title while %s: %s', c.role, c.status, c.expected)
)
from (
select s.n as sn, r.n as rn, r.role, s.status,
  case
    when r.role in ('member', 'loner') then 'hidden'
    when r.role in ('author', 'admin') and s.status in ('draft', 'to_decide') then 'ok'
    else 'denied'
  end as expected
from (values (1, 'draft'), (2, 'to_decide'), (3, 'decided'), (4, 'archived')) as s (n, status)
cross join (values (1, 'author'), (2, 'decider'), (3, 'admin'), (4, 'member'), (5, 'loner')) as r (n, role)
) as c
order by c.sn, c.rn;

-- ---------- the guard's messages ----------
update public.memos set status = 'draft', title = 'Matrix memo' where id = bxh_test.memo(1);
call bxh_test.login('decider');
select throws_ok(
  $$ update public.memos set title = 'Mine now' where id = bxh_test.memo(1) $$,
  '42501', 'only the author can edit this memo',
  'the decision maker cannot edit the memo'
);
select throws_ok(
  $$ update public.memos set decider_id = bxh_test.uid('admin') where id = bxh_test.memo(2) $$,
  '42501', 'only the author can edit this memo',
  'the decision maker cannot reassign the decision (decider_id is content)'
);
call bxh_test.login('author');
select throws_ok(
  $$ update public.memos set status = 'decided' where id = bxh_test.memo(1) $$,
  '42501', 'memo status change not allowed: draft -> decided',
  'a status change outside the workflow names the transition'
);
call bxh_test.logout();
update public.memos set status = 'decided' where id = bxh_test.memo(1);
call bxh_test.login('author');
select throws_ok(
  $$ update public.memos set content = '{"kind": "memo"}' where id = bxh_test.memo(1) $$,
  '42501', 'memo is locked once decided or archived',
  'a decided memo cannot be edited, even by its author'
);
select throws_ok(
  $$ update public.memos set lang = 'en' where id = bxh_test.memo(1) $$,
  '42501', 'memo is locked once decided or archived',
  'nor can its language'
);

-- ---------- submit needs a decision maker and a title ----------
call bxh_test.logout();
update public.memos set status = 'draft', decider_id = null where id = bxh_test.memo(2);
call bxh_test.login('author');
select throws_ok(
  $$ update public.memos set status = 'to_decide' where id = bxh_test.memo(2) $$,
  '23514', 'a memo to decide needs a decision maker and a title',
  'submitting without a decision maker fails'
);
select throws_ok(
  $$ update public.memos set status = 'to_decide', decider_id = bxh_test.uid('decider'), title = '   ' where id = bxh_test.memo(2) $$,
  '23514', 'a memo to decide needs a decision maker and a title',
  'submitting with a blank title fails'
);
select lives_ok(
  $$ update public.memos set status = 'to_decide', decider_id = bxh_test.uid('decider') where id = bxh_test.memo(2) $$,
  'choosing the decision maker and submitting in one update works'
);
select throws_ok(
  $$ update public.memos set decider_id = null where id = bxh_test.memo(2) $$,
  '23514', 'a memo to decide needs a decision maker and a title',
  'a memo to decide cannot lose its decision maker'
);
select lives_ok(
  $$ update public.memos set lang = 'en', decider_id = bxh_test.uid('admin'), title = 'Second memo, v2' where id = bxh_test.memo(2) $$,
  'while to decide, the author can still change title, language and decision maker'
);
select results_eq(
  $$ select lang::text, decider_id, title from public.memos where id = bxh_test.memo(2) $$,
  $$ values ('en', bxh_test.uid('admin'), 'Second memo, v2') $$,
  'and the changes are stored'
);

-- ---------- immutable columns ----------
select throws_ok(
  $$ update public.memos set id = gen_random_uuid() where id = bxh_test.memo(2) $$,
  '42501', 'memo column id cannot be changed',
  'id never changes'
);
select throws_ok(
  $$ update public.memos set team = 'growth' where id = bxh_test.memo(2) $$,
  '42501', 'memo column team cannot be changed',
  'team never changes'
);
select throws_ok(
  $$ update public.memos set author_id = bxh_test.uid('member') where id = bxh_test.memo(2) $$,
  '42501', 'memo column author_id cannot be changed',
  'author_id never changes'
);
select throws_ok(
  $$ update public.memos set created_at = '2020-01-01' where id = bxh_test.memo(2) $$,
  '42501', 'memo column created_at cannot be changed',
  'created_at never changes'
);
call bxh_test.login('admin');
select throws_ok(
  $$ update public.memos set team = 'growth' where id = bxh_test.memo(2) $$,
  '42501', 'memo column team cannot be changed',
  'not even for an admin'
);

-- ---------- derived columns ----------
call bxh_test.logout();
update public.memos set status = 'to_decide', decider_id = bxh_test.uid('decider'), updated_at = '2020-01-01'
where id = bxh_test.memo(1);
select is(
  (select updated_at from public.memos where id = bxh_test.memo(1)),
  '2020-01-01'::timestamptz,
  'a trusted caller may set updated_at explicitly (imports)'
);
call bxh_test.login('decider');
select lives_ok(
  $$ update public.memos set status = 'decided', decided_at = '2020-01-01', updated_at = '2020-01-01' where id = bxh_test.memo(1) $$,
  'the decision maker decides'
);
select results_eq(
  $$ select decided_at, updated_at from public.memos where id = bxh_test.memo(1) $$,
  $$ values (now(), now()) $$,
  'deciding sets decided_at and updated_at to now (client values are ignored)'
);
select lives_ok(
  $$ update public.memos set asana_task_gid = '1209876543210' where id = bxh_test.memo(1) $$,
  'the decision maker can link a decided memo to its Asana task'
);
select throws_ok(
  $$ update public.memos set asana_task_gid = 'https://app.asana.com/0/1/2' where id = bxh_test.memo(1) $$,
  '23514', null,
  'asana_task_gid must be a numeric gid'
);
select lives_ok(
  $$ update public.memos set status = 'to_decide' where id = bxh_test.memo(1) $$,
  'the decision maker reopens'
);
select is((select decided_at from public.memos where id = bxh_test.memo(1)), null,
  'reopening clears decided_at');
call bxh_test.logout();
update public.memos set status = 'decided' where id = bxh_test.memo(1);
call bxh_test.login('author');
select lives_ok(
  $$ update public.memos set status = 'archived' where id = bxh_test.memo(1) $$,
  'the author archives a decided memo'
);
select isnt((select decided_at from public.memos where id = bxh_test.memo(1)), null,
  'archiving keeps decided_at');
select lives_ok(
  $$ update public.memos set status = 'draft' where id = bxh_test.memo(1) $$,
  'the author restores it as a draft'
);
select is((select decided_at from public.memos where id = bxh_test.memo(1)), null,
  'restoring clears decided_at');
select lives_ok(
  $$ update public.memos set status = 'draft', title = 'Same status' where id = bxh_test.memo(1) $$,
  'writing the current status again is not a transition'
);
select lives_ok(
  $$ update public.memos set decided_at = now() where id = bxh_test.memo(1) $$,
  'writing decided_at is accepted…'
);
select is((select decided_at from public.memos where id = bxh_test.memo(1)), null,
  '…but ignored: only status changes move decided_at');

-- ---------- trusted callers bypass the guard ----------
call bxh_test.logout();
update public.memos set status = 'decided' where id = bxh_test.memo(1);
call bxh_test.login_role('service_role');
select lives_ok(
  $$ update public.memos set title = 'Fixed by support', author_id = bxh_test.uid('member') where id = bxh_test.memo(1) $$,
  'the service role can fix a decided memo, including its author'
);
select results_eq(
  $$ select title, author_id, status::text from public.memos where id = bxh_test.memo(1) $$,
  $$ values ('Fixed by support', bxh_test.uid('member'), 'decided') $$,
  'and the fix is stored'
);
call bxh_test.logout();

select * from finish();
rollback;
