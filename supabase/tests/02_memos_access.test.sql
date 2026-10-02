-- Who sees which memo, who may create and delete one, and what anon gets (nothing).
begin;
-- pgTAP: installed by `supabase test db` and scripts/db-test.sh (possibly as plain SQL).
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(45);

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

-- Impersonate a signed-in user the way PostgREST does.
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

-- Back to the test runner (a trusted caller: no auth.uid()).
create procedure bxh_test.logout() language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;

-- Rows affected by a statement (RLS silently skips rows it hides).
create function bxh_test.rows(p_sql text) returns int language plpgsql as $$
declare
  v_rows int;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- The fixture memos the current user can see, by title.
create function bxh_test.visible() returns text[] language sql as $$
  select coalesce(array_agg(title order by title), '{}')
  from public.memos where id::text like 'f0000000-%'
$$;

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('admin'), 'pgtap.admin@boxhero.test'),        -- admin, no team
  (bxh_test.uid('author'), 'pgtap.author@boxhero.test'),      -- ops
  (bxh_test.uid('member'), 'pgtap.member@boxhero.test'),      -- ops
  (bxh_test.uid('decider'), 'pgtap.decider@boxhero.test'),    -- finance
  (bxh_test.uid('outsider'), 'pgtap.outsider@boxhero.test'),  -- growth
  (bxh_test.uid('loner'), 'pgtap.loner@boxhero.test');        -- no team
insert into public.team_members (user_id, team) values
  (bxh_test.uid('author'), 'ops'),
  (bxh_test.uid('member'), 'ops'),
  (bxh_test.uid('decider'), 'finance'),
  (bxh_test.uid('outsider'), 'growth');

-- Written as the trusted runner, so author and status are taken as given.
insert into public.memos (id, team, lang, title, author_id, decider_id, status) values
  (bxh_test.memo(1), 'ops', 'fr', 'ops-draft', bxh_test.uid('author'), bxh_test.uid('decider'), 'draft'),
  (bxh_test.memo(2), 'ops', 'fr', 'ops-to-decide', bxh_test.uid('author'), bxh_test.uid('decider'), 'to_decide'),
  (bxh_test.memo(3), 'crea', 'fr', 'crea-by-author', bxh_test.uid('author'), null, 'draft'),
  (bxh_test.memo(4), 'growth', 'en', 'growth-by-outsider', bxh_test.uid('outsider'), null, 'draft'),
  (bxh_test.memo(5), 'finance', 'fr', 'finance-by-decider', bxh_test.uid('decider'), bxh_test.uid('admin'), 'to_decide'),
  (bxh_test.memo(6), 'sav', 'fr', 'sav-by-loner', bxh_test.uid('loner'), bxh_test.uid('member'), 'to_decide'),
  (bxh_test.memo(7), 'mini', 'fr', 'mini-archived', bxh_test.uid('member'), null, 'archived');

-- ---------- visibility ----------
call bxh_test.login('admin');
select is(bxh_test.visible(),
  array['crea-by-author', 'finance-by-decider', 'growth-by-outsider', 'mini-archived', 'ops-draft', 'ops-to-decide', 'sav-by-loner'],
  'an admin sees every memo');
call bxh_test.login('author');
select is(bxh_test.visible(), array['crea-by-author', 'ops-draft', 'ops-to-decide'],
  'the author sees their team''s memos and their own memo for another team');
call bxh_test.login('member');
select is(bxh_test.visible(), array['mini-archived', 'ops-draft', 'ops-to-decide', 'sav-by-loner'],
  'a team member sees the team''s memos (any author), their own, and those they decide');
call bxh_test.login('decider');
select is(bxh_test.visible(), array['finance-by-decider', 'ops-draft', 'ops-to-decide'],
  'a decision maker sees the memos they decide, even from another team');
call bxh_test.login('outsider');
select is(bxh_test.visible(), array['growth-by-outsider'],
  'a member of another team sees none of the ops memos');
call bxh_test.login('loner');
select is(bxh_test.visible(), array['sav-by-loner'],
  'someone without a team sees only their own memos');
select is_empty(
  $$ select 1 from public.memos where team = 'ops' $$,
  'filtering by team does not reveal hidden memos'
);
call bxh_test.login_role('authenticated');
select is(bxh_test.visible(), '{}'::text[], 'a token without a user id sees nothing');
call bxh_test.login_role('service_role');
select is(array_length(bxh_test.visible(), 1), 7, 'the service role sees everything');

call bxh_test.logout();
insert into public.team_members (user_id, team) values (bxh_test.uid('loner'), 'ops');
call bxh_test.login('loner');
select is(bxh_test.visible(), array['ops-draft', 'ops-to-decide', 'sav-by-loner'],
  'joining a team reveals its memos');
call bxh_test.logout();
delete from public.team_members where user_id = bxh_test.uid('loner');

-- ---------- insert ----------
call bxh_test.login('author');
select lives_ok(
  $$ insert into public.memos (id, team, lang, title, author_id, status, decided_at, created_at, asana_task_gid)
     values (bxh_test.memo(10), 'ops', 'en', 'spoofed', bxh_test.uid('member'), 'decided', now(), '2020-01-01', '123') $$,
  'a signed-in user can create a memo'
);
select is((select author_id from public.memos where id = bxh_test.memo(10)), bxh_test.uid('author'),
  'author_id is always the caller (spoofing another author is ignored)');
select is((select status::text from public.memos where id = bxh_test.memo(10)), 'draft',
  'a new memo is always a draft');
select is((select decided_at from public.memos where id = bxh_test.memo(10)), null,
  'a new memo has no decided_at');
select is((select created_at from public.memos where id = bxh_test.memo(10)), now(),
  'created_at cannot be backdated');
select is((select asana_task_gid from public.memos where id = bxh_test.memo(10)), null,
  'a new memo is not linked to an Asana task');
-- A memo is created in one of the author's teams (admins: any team); the decision
-- maker can be anyone, and reads the memo as its decision maker.
select throws_ok(
  $$ insert into public.memos (id, team, lang) values (bxh_test.memo(11), 'finance', 'fr') $$,
  '42501', 'new row violates row-level security policy for table "memos"',
  'a memo cannot be created in a team one is not in'
);
select throws_ok(
  $$ insert into public.memos (team, lang, decider_id) values ('growth', 'fr', bxh_test.uid('outsider')) $$,
  '42501', 'new row violates row-level security policy for table "memos"',
  'not even to send it to someone of that team'
);
select lives_ok(
  $$ insert into public.memos (id, team, lang, title, decider_id)
     values (bxh_test.memo(13), 'ops', 'fr', 'ops-for-outsider', bxh_test.uid('outsider')) $$,
  'a memo of one''s own team can go to a decision maker from any team'
);
call bxh_test.login('outsider');
select ok('ops-for-outsider' = any (bxh_test.visible()), 'who then reads it as its decision maker');
call bxh_test.login('admin');
select lives_ok(
  $$ insert into public.memos (id, team, lang) values (bxh_test.memo(11), 'finance', 'fr') $$,
  'an admin (in no team) can create a memo in any team, with defaults for everything else'
);
select results_eq(
  $$ select author_id, team::text, status::text from public.memos where id = bxh_test.memo(11) $$,
  $$ values (bxh_test.uid('admin'), 'finance', 'draft') $$,
  'and reads it back'
);
call bxh_test.login('loner');
select throws_ok(
  $$ insert into public.memos (team, lang) values ('ops', 'fr') $$,
  '42501', 'new row violates row-level security policy for table "memos"',
  'someone in no team cannot create a memo'
);
select throws_ok(
  $$ insert into public.memos (team, lang) values ('mini', 'fr') $$,
  '42501', 'new row violates row-level security policy for table "memos"',
  'not even a mini memo'
);
call bxh_test.login('author');
select throws_ok(
  $$ insert into public.memos (team, lang, content) values ('ops', 'fr', '["not", "an", "object"]') $$,
  '23514', null,
  'content must be a JSON object'
);
select throws_ok(
  $$ insert into public.memos (team, lang, title) values ('ops', 'fr', repeat('t', 301)) $$,
  '23514', null,
  'titles are limited to 300 characters'
);
select throws_ok(
  $$ insert into public.memos (team, lang, content)
     values ('ops', 'fr', jsonb_build_object('res', repeat('x', 300000))) $$,
  '23514', null,
  'content is limited to about 256 kB'
);
call bxh_test.login_role('authenticated');
select throws_ok(
  $$ insert into public.memos (team, lang) values ('ops', 'fr') $$,
  '42501', null,
  'a token without a user id cannot create a memo'
);
call bxh_test.login_role('service_role');
select lives_ok(
  $$ insert into public.memos (id, team, lang, title, author_id, decider_id, status)
     values (bxh_test.memo(12), 'ops', 'fr', 'imported', bxh_test.uid('member'), bxh_test.uid('admin'), 'decided') $$,
  'the service role can import a memo as is'
);
select results_eq(
  $$ select author_id, status::text, decided_at is not null from public.memos where id = bxh_test.memo(12) $$,
  $$ values (bxh_test.uid('member'), 'decided', true) $$,
  'the service role keeps author and status; decided_at follows the status'
);

-- ---------- delete ----------
call bxh_test.login('author');
select is(bxh_test.rows($$ delete from public.memos where id = bxh_test.memo(3) $$), 1,
  'the author deletes their draft');
select is(bxh_test.rows($$ delete from public.memos where id = bxh_test.memo(2) $$), 0,
  'the author cannot delete a memo that is to decide (archive it instead)');
call bxh_test.login('decider');
select is(bxh_test.rows($$ delete from public.memos where id = bxh_test.memo(1) $$), 0,
  'the decision maker cannot delete the author''s draft');
call bxh_test.login('member');
select is(bxh_test.rows($$ delete from public.memos where id = bxh_test.memo(1) $$), 0,
  'a team member cannot delete a teammate''s draft');
select is(bxh_test.rows($$ delete from public.memos where id = bxh_test.memo(7) $$), 0,
  'the author cannot delete their archived memo');
call bxh_test.logout();
insert into public.memo_answers (memo_id, question_id, answer, answered_by)
values (bxh_test.memo(2), 'q1', 'Oui', bxh_test.uid('decider'));
call bxh_test.login('admin');
select is(bxh_test.rows($$ delete from public.memos where id = bxh_test.memo(2) $$), 1,
  'an admin can delete any memo');
call bxh_test.logout();
select is_empty($$ select 1 from public.memo_answers where memo_id = bxh_test.memo(2) $$,
  'deleting a memo deletes its answers');
select isnt_empty($$ select 1 from public.memos where id = bxh_test.memo(1) $$,
  'memos that could not be deleted are still there');

-- ---------- anon gets nothing ----------
call bxh_test.login_role('anon');
select throws_ok($$ select * from public.memos $$, '42501', 'permission denied for table memos',
  'anon cannot read memos');
select throws_ok($$ select * from public.profiles $$, '42501', 'permission denied for table profiles',
  'anon cannot read profiles');
select throws_ok($$ select * from public.team_members $$, '42501', 'permission denied for table team_members',
  'anon cannot read team_members');
select throws_ok($$ select * from public.memo_answers $$, '42501', 'permission denied for table memo_answers',
  'anon cannot read memo_answers');
select throws_ok($$ insert into public.memos (team, lang) values ('ops', 'fr') $$, '42501', 'permission denied for table memos',
  'anon cannot create memos');
select throws_ok($$ select private.is_admin() $$, '42501', 'permission denied for schema private',
  'anon cannot call the helper functions');
call bxh_test.login('author');
select throws_ok($$ select * from private.allowed_email_domains $$, '42501', 'permission denied for table allowed_email_domains',
  'signed-in users cannot read the allowed domains');
call bxh_test.logout();

select * from finish();
rollback;
