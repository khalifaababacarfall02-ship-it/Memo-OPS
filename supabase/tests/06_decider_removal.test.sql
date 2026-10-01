-- A deleted decision maker (memos_decider_id_fkey: on delete set null): memos waiting
-- for them go back to draft, so their author can edit them and pick someone else.
-- Decided memos keep their status. A user clearing the decision maker themselves is
-- still refused (03_workflow.test.sql).
begin;
-- pgTAP: installed by `supabase test db` and scripts/db-test.sh (possibly as plain SQL).
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(16);

-- ---------- helpers (rolled back with the transaction) ----------
create schema bxh_test;
grant usage on schema bxh_test to public;

create function bxh_test.uid(p_name text) returns uuid language plpgsql immutable as $$
begin
  return case p_name
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'author' then 'a0000000-0000-4000-8000-000000000002'
    when 'decider' then 'a0000000-0000-4000-8000-000000000004'
    when 'decider2' then 'a0000000-0000-4000-8000-000000000007'
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

-- Claims of a signed-in user while staying the test runner (who may delete auth users).
create procedure bxh_test.claims(p_name text) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_name is null then ''
    else json_build_object('sub', bxh_test.uid(p_name), 'role', 'authenticated')::text end, true);
end $$;

create function bxh_test.state(p_n int) returns text language sql stable as $$
  select status::text || ' ' || coalesce(decider_id::text, 'nobody') || ' ' || (decided_at is not null)::text
  from public.memos where id = bxh_test.memo(p_n)
$$;

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('admin'), 'pgtap.admin@boxhero.test'),
  (bxh_test.uid('author'), 'pgtap.author@boxhero.test'),
  (bxh_test.uid('decider'), 'pgtap.decider@boxhero.test'),
  (bxh_test.uid('decider2'), 'pgtap.decider2@boxhero.test');
insert into public.team_members (user_id, team) values (bxh_test.uid('author'), 'ops');

insert into public.memos (id, team, lang, title, author_id, decider_id, status, updated_at) values
  (bxh_test.memo(1), 'ops', 'fr', 'Waiting', bxh_test.uid('author'), bxh_test.uid('decider'), 'to_decide', '2020-01-01'),
  (bxh_test.memo(2), 'ops', 'fr', 'Decided', bxh_test.uid('author'), bxh_test.uid('decider'), 'decided', '2020-01-01'),
  (bxh_test.memo(3), 'ops', 'fr', 'Draft', bxh_test.uid('author'), bxh_test.uid('decider'), 'draft', '2020-01-01'),
  (bxh_test.memo(4), 'ops', 'fr', 'Archived', bxh_test.uid('author'), bxh_test.uid('decider'), 'archived', '2020-01-01'),
  (bxh_test.memo(5), 'ops', 'fr', 'Other decider', bxh_test.uid('author'), bxh_test.uid('decider2'), 'to_decide', '2020-01-01');

-- ---------- deleted by a trusted caller (Auth admin API, dashboard, SQL editor) ----------
select lives_ok(
  $$ delete from auth.users where id = bxh_test.uid('decider') $$,
  'a decision maker with memos waiting for them can be deleted'
);
select is(bxh_test.state(1), 'draft nobody false',
  'a memo waiting for the deleted decision maker goes back to draft');
select ok((select updated_at > '2020-01-01' from public.memos where id = bxh_test.memo(1)),
  'and shows up as changed');
select is(bxh_test.state(2), 'decided nobody true', 'a decided memo stays decided');
select is(bxh_test.state(3), 'draft nobody false', 'a draft stays a draft');
select is(bxh_test.state(4), 'archived nobody false', 'an archived memo stays archived');
select is(bxh_test.state(5), format('to_decide %s false', bxh_test.uid('decider2')),
  'memos of other decision makers are untouched');

-- ---------- the author takes over ----------
call bxh_test.login('author');
select lives_ok(
  $$ update public.memos set title = 'Waiting, edited' where id = bxh_test.memo(1) $$,
  'the author can edit the memo again'
);
select lives_ok(
  $$ update public.memos set decider_id = bxh_test.uid('decider2'), status = 'to_decide' where id = bxh_test.memo(1) $$,
  'and send it to another decision maker'
);
select throws_ok(
  $$ update public.memos set decider_id = null where id = bxh_test.memo(1) $$,
  '23514', 'a memo to decide needs a decision maker and a title',
  'clearing the decision maker oneself is still refused'
);
call bxh_test.logout();

-- ---------- deleted inside a signed-in session ----------
-- The foreign key action then runs with the session's auth.uid(); it is still a
-- cleanup, not an edit by that person.
call bxh_test.claims('admin');
select is(auth.uid(), bxh_test.uid('admin'), 'the session has a user');
select lives_ok(
  $$ delete from auth.users where id = bxh_test.uid('decider2') $$,
  'deleting a decision maker works there too'
);
call bxh_test.claims(null);
select is(bxh_test.state(1), 'draft nobody false', 'the memo sent to them goes back to draft');
select is(bxh_test.state(5), 'draft nobody false', 'and so does the other one');

-- ---------- a trusted caller clearing the decision maker by hand ----------
update public.memos set decider_id = bxh_test.uid('author'), status = 'to_decide' where id = bxh_test.memo(3);
update public.memos set decider_id = null where id = bxh_test.memo(3);
select is(bxh_test.state(3), 'draft nobody false', 'gets the same result');
select is_empty(
  $$ select 1 from public.memos where status = 'to_decide' and decider_id is null $$,
  'no memo is left to decide by nobody'
);

select * from finish();
rollback;
