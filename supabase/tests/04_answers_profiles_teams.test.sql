-- memo_answers (the decision maker answers while the memo is to decide), the profiles
-- guard (admin rights, immutable columns) and team_members (admins only).
begin;
-- pgTAP: installed by `supabase test db` and scripts/db-test.sh (possibly as plain SQL).
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(50);

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
    when 'admin2' then 'a0000000-0000-4000-8000-000000000007'
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

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  (bxh_test.uid('admin'), 'pgtap.admin@boxhero.test', '{}'),        -- admin, no team
  (bxh_test.uid('author'), 'pgtap.author@boxhero.test', '{"full_name": "Olivia"}'),  -- ops
  (bxh_test.uid('member'), 'pgtap.member@boxhero.test', '{}'),      -- ops
  (bxh_test.uid('decider'), 'pgtap.decider@boxhero.test', '{}'),    -- finance
  (bxh_test.uid('loner'), 'pgtap.loner@boxhero.test', '{}');        -- no team
insert into public.team_members (user_id, team) values
  (bxh_test.uid('author'), 'ops'),
  (bxh_test.uid('member'), 'ops'),
  (bxh_test.uid('decider'), 'finance');
-- Only the fixture admin counts as an admin here (a local Supabase may have others).
update public.profiles set is_admin = false where is_admin and id <> bxh_test.uid('admin');

insert into public.memos (id, team, lang, title, author_id, decider_id, status, content) values
  (bxh_test.memo(1), 'ops', 'fr', 'To decide', bxh_test.uid('author'), bxh_test.uid('decider'), 'to_decide',
   '{"kind": "memo", "qs": [{"id": "q1", "q": "Oui ?"}, {"id": "q2", "q": "Quand ?"}]}'),
  (bxh_test.memo(2), 'ops', 'fr', 'Draft', bxh_test.uid('author'), bxh_test.uid('decider'), 'draft',
   '{"kind": "memo", "qs": [{"id": "q1", "q": "Oui ?"}]}'),
  (bxh_test.memo(3), 'ops', 'fr', 'Decided', bxh_test.uid('author'), bxh_test.uid('decider'), 'decided',
   '{"kind": "memo", "qs": [{"id": "q1", "q": "Oui ?"}]}');

-- ---------- answers: who writes ----------
call bxh_test.login('decider');
select lives_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer, answered_by)
     values (bxh_test.memo(1), 'q1', 'Oui, on lance lundi.', bxh_test.uid('author')) $$,
  'the decision maker answers a question of a memo to decide'
);
select is(
  (select answered_by from public.memo_answers where memo_id = bxh_test.memo(1) and question_id = 'q1'),
  bxh_test.uid('decider'),
  'answered_by is always the caller (spoofing is ignored)'
);
select lives_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(1), 'q1', 'Oui, mardi.')
     on conflict (memo_id, question_id) do update set answer = excluded.answer $$,
  'the decision maker can upsert an answer (what supabase-js upsert sends)'
);
select is(
  (select answer from public.memo_answers where memo_id = bxh_test.memo(1) and question_id = 'q1'),
  'Oui, mardi.',
  'the upsert replaced the answer'
);
select throws_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(1), 'q9', 'Hm') $$,
  '23503', 'question not found in this memo',
  'an answer must match a question of the memo'
);
select throws_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(1), 'q2', repeat('x', 20001)) $$,
  '23514', null,
  'answers are limited to 20000 characters'
);
call bxh_test.logout();
select throws_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer, answered_by)
     values (bxh_test.memo(1), '', 'Hm', bxh_test.uid('decider')) $$,
  '23514', null,
  'question_id cannot be empty, even for a trusted caller'
);
call bxh_test.login('decider');
select throws_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(2), 'q1', 'Trop tôt') $$,
  '42501', 'only the decision maker can answer, while the memo is to decide',
  'no answer while the memo is a draft'
);
select throws_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(3), 'q1', 'Trop tard') $$,
  '42501', 'only the decision maker can answer, while the memo is to decide',
  'no answer once the memo is decided'
);
select throws_ok(
  $$ update public.memo_answers set question_id = 'q2' where memo_id = bxh_test.memo(1) and question_id = 'q1' $$,
  '42501', 'answer memo_id and question_id cannot be changed',
  'an answer cannot be moved to another question'
);
select is(
  bxh_test.rows($$ update public.memo_answers set answer = 'Oui.' where memo_id = bxh_test.memo(1) and question_id = 'q1' $$),
  1,
  'the decision maker edits their answer'
);
call bxh_test.login('author');
select throws_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(1), 'q2', 'Je réponds moi-même') $$,
  '42501', 'only the decision maker can answer, while the memo is to decide',
  'the author cannot answer'
);
select is(
  bxh_test.rows($$ update public.memo_answers set answer = 'Non.' where memo_id = bxh_test.memo(1) $$),
  0,
  'the author cannot overwrite the answer'
);
select is(
  bxh_test.rows($$ delete from public.memo_answers where memo_id = bxh_test.memo(1) $$),
  0,
  'the author cannot delete the answer'
);
call bxh_test.login('member');
select throws_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(1), 'q2', 'Moi aussi') $$,
  '42501', 'only the decision maker can answer, while the memo is to decide',
  'a team member cannot answer'
);
call bxh_test.login('admin');
select lives_ok(
  $$ insert into public.memo_answers (memo_id, question_id, answer) values (bxh_test.memo(1), 'q2', 'Fin octobre.') $$,
  'an admin can answer'
);

-- ---------- answers: who reads ----------
call bxh_test.login('author');
select is((select count(*) from public.memo_answers where memo_id = bxh_test.memo(1)), 2::bigint,
  'the author reads the answers');
call bxh_test.login('member');
select is((select count(*) from public.memo_answers where memo_id = bxh_test.memo(1)), 2::bigint,
  'a team member reads the answers');
call bxh_test.login('decider');
select is((select count(*) from public.memo_answers where memo_id = bxh_test.memo(1)), 2::bigint,
  'the decision maker reads the answers');
call bxh_test.login('loner');
select is((select count(*) from public.memo_answers where memo_id = bxh_test.memo(1)), 0::bigint,
  'someone who cannot read the memo cannot read its answers');

-- ---------- answers: after the decision ----------
call bxh_test.logout();
update public.memos set status = 'decided' where id = bxh_test.memo(1);
call bxh_test.login('decider');
select is(
  bxh_test.rows($$ update public.memo_answers set answer = 'Finalement non.' where memo_id = bxh_test.memo(1) $$),
  0,
  'answers are frozen once the memo is decided'
);
select is(
  bxh_test.rows($$ delete from public.memo_answers where memo_id = bxh_test.memo(1) $$),
  0,
  'and cannot be deleted'
);
call bxh_test.logout();
update public.memos set status = 'to_decide' where id = bxh_test.memo(1);
call bxh_test.login('decider');
select is(
  bxh_test.rows($$ delete from public.memo_answers where memo_id = bxh_test.memo(1) and question_id = 'q2' $$),
  1,
  'after reopening, the decision maker can delete an answer'
);
call bxh_test.logout();

-- ---------- profiles ----------
call bxh_test.login('author');
select is(
  (select count(*) from public.profiles where id::text like 'a0000000-%'),
  5::bigint,
  'every signed-in user reads every profile (to pick a decision maker)'
);
select is(
  bxh_test.rows($$ update public.profiles set full_name = 'Olivia M.', asana_user_gid = '1200000000001' where id = bxh_test.uid('author') $$),
  1,
  'a user updates their own name and Asana id'
);
select throws_ok(
  $$ update public.profiles set asana_user_gid = 'olivia' where id = bxh_test.uid('author') $$,
  '23514', null,
  'the Asana id must be a numeric gid'
);
select throws_ok(
  $$ update public.profiles set full_name = repeat('n', 121) where id = bxh_test.uid('author') $$,
  '23514', null,
  'names are limited to 120 characters'
);
select is(
  bxh_test.rows($$ update public.profiles set full_name = 'Hacked' where id = bxh_test.uid('member') $$),
  0,
  'a user cannot rename someone else'
);
select throws_ok(
  $$ update public.profiles set is_admin = true where id = bxh_test.uid('author') $$,
  '42501', 'only an admin can change admin rights',
  'a user cannot make themselves admin'
);
select throws_ok(
  $$ update public.profiles set email = 'pgtap.boss@boxhero.test' where id = bxh_test.uid('author') $$,
  '42501', null,
  'the profile email cannot be edited (column not writable; the guard refuses it too)'
);
select throws_ok(
  $$ update public.profiles set id = bxh_test.uid('admin2') where id = bxh_test.uid('author') $$,
  '42501', null,
  'the profile id cannot be edited (column not writable; the guard refuses it too)'
);
select throws_ok(
  $$ update public.profiles set created_at = '2020-01-01', updated_at = '2020-01-01' where id = bxh_test.uid('author') $$,
  '42501', null,
  'the timestamps are not writable…'
);
select results_eq(
  $$ select created_at < '2021-01-01' from public.profiles where id = bxh_test.uid('author') $$,
  $$ values (false) $$,
  '…and created_at is kept'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values (gen_random_uuid(), 'pgtap.ghost@boxhero.test') $$,
  '42501', 'permission denied for table profiles',
  'profiles cannot be created through the API'
);
select throws_ok(
  $$ delete from public.profiles where id = bxh_test.uid('author') $$,
  '42501', 'permission denied for table profiles',
  'profiles cannot be deleted through the API'
);

call bxh_test.logout();
insert into auth.users (id, email) values (bxh_test.uid('admin2'), 'pgtap.admin2@boxhero.test');
call bxh_test.login('admin');
select is(
  bxh_test.rows($$ update public.profiles set is_admin = true where id = bxh_test.uid('admin2') $$),
  1,
  'an admin makes someone admin'
);
call bxh_test.login('admin2');
select is(
  (select count(*) from public.memos where id::text like 'f0000000-%'),
  3::bigint,
  'the new admin sees every memo'
);
select is(
  bxh_test.rows($$ update public.profiles set is_admin = false where id = bxh_test.uid('admin') $$),
  1,
  'an admin removes another admin''s rights'
);
select throws_ok(
  $$ update public.profiles set is_admin = false where id = bxh_test.uid('admin2') $$,
  '42501', 'cannot remove the last admin',
  'the last admin cannot remove their own rights'
);
select is(
  bxh_test.rows($$ update public.profiles set full_name = 'Renamed by admin' where id = bxh_test.uid('member') $$),
  1,
  'an admin can rename anyone'
);

-- ---------- team_members ----------
call bxh_test.login('loner');
select is(
  (select count(*) from public.team_members where user_id::text like 'a0000000-%'),
  3::bigint,
  'every signed-in user reads the team memberships'
);
select throws_ok(
  $$ insert into public.team_members (user_id, team) values (bxh_test.uid('loner'), 'ops') $$,
  '42501', 'new row violates row-level security policy for table "team_members"',
  'a user cannot join a team by themselves'
);
select is(
  bxh_test.rows($$ delete from public.team_members where user_id = bxh_test.uid('author') $$),
  0,
  'a user cannot remove someone from a team'
);
select throws_ok(
  $$ update public.team_members set team = 'ops' where user_id = bxh_test.uid('decider') $$,
  '42501', 'permission denied for table team_members',
  'memberships are never updated (delete + insert instead)'
);
call bxh_test.login('admin2');
select lives_ok(
  $$ insert into public.team_members (user_id, team) values (bxh_test.uid('loner'), 'ops') $$,
  'an admin adds someone to a team'
);
call bxh_test.login('loner');
select is(
  (select count(*) from public.memos where id::text like 'f0000000-%'),
  3::bigint,
  'the new member now reads the team''s memos'
);
select is(
  (select count(*) from public.memo_answers where memo_id = bxh_test.memo(1)),
  1::bigint,
  'and their answers'
);
call bxh_test.login('admin2');
select is(
  bxh_test.rows($$ delete from public.team_members where user_id = bxh_test.uid('loner') and team = 'ops' $$),
  1,
  'an admin removes someone from a team'
);
call bxh_test.login('loner');
select is(
  (select count(*) from public.memos where id::text like 'f0000000-%'),
  0::bigint,
  'and they lose access to its memos'
);
select throws_ok(
  $$ insert into public.team_members (user_id, team) values (bxh_test.uid('loner'), 'marketing') $$,
  '22P02', null,
  'only the six teams exist'
);
call bxh_test.logout();

select * from finish();
rollback;
