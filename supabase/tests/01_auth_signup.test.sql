-- Sign-up restriction (auth.users triggers), profile creation and bootstrap admins.
begin;
-- pgTAP: installed by `supabase test db` and scripts/db-test.sh (possibly as plain SQL).
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(34);

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

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.admin@boxhero.test') on conflict do nothing;

-- ---------- allowed domains ----------
select lives_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values (bxh_test.uid('author'), 'pgtap.author@boxhero.test', '{"full_name": "  Olivia Martin "}') $$,
  'an address on an allowed domain can sign up'
);
select results_eq(
  $$ select email, full_name, is_admin from public.profiles where id = bxh_test.uid('author') $$,
  $$ values ('pgtap.author@boxhero.test', 'Olivia Martin', false) $$,
  'the profile is created with the trimmed full_name from the metadata, not admin'
);
select lives_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values (bxh_test.uid('member'), 'Pgtap.Member@BoxHero.TEST', '{"name": "Oscar"}') $$,
  'the domain check is case-insensitive'
);
select results_eq(
  $$ select email, full_name from public.profiles where id = bxh_test.uid('member') $$,
  $$ values ('pgtap.member@boxhero.test', 'Oscar') $$,
  'profile email is lower-cased; full_name falls back to metadata "name"'
);
select lives_ok(
  $$ insert into auth.users (id, email) values (bxh_test.uid('decider'), 'pgtap.decider@boxhero.test') $$,
  'metadata is optional'
);
select is(
  (select full_name from public.profiles where id = bxh_test.uid('decider')),
  'pgtap.decider',
  'without a name in the metadata, full_name is the local part of the email'
);
select lives_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values (bxh_test.uid('loner'), 'pgtap.loner@boxhero.test', jsonb_build_object('full_name', repeat('x', 300))) $$,
  'a very long name does not block the sign-up'
);
select is(
  (select char_length(full_name) from public.profiles where id = bxh_test.uid('loner')),
  120,
  'full_name is cut to 120 characters'
);

-- ---------- blocked domains ----------
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'someone@gmail.com') $$,
  '42501', 'email domain not allowed',
  'another domain is rejected'
);
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'someone@mail.boxhero.test') $$,
  '42501', 'email domain not allowed',
  'a subdomain of an allowed domain is rejected (exact match only)'
);
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'someone@boxhero.test.evil.com') $$,
  '42501', 'email domain not allowed',
  'a look-alike domain that starts with the allowed one is rejected'
);
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'someone@evilboxhero.test') $$,
  '42501', 'email domain not allowed',
  'a look-alike domain that ends with the allowed one is rejected'
);
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'someone@gmail.com@boxhero.test') $$,
  '42501', 'email domain not allowed',
  'an address with two @ is rejected'
);
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), null) $$,
  '42501', 'email domain not allowed',
  'a user without email (phone, anonymous) is rejected'
);
select is(
  (select count(*) from public.profiles where email not like '%@boxhero.test'),
  0::bigint,
  'no profile was created for a rejected address'
);

-- ---------- email changes ----------
select throws_ok(
  $$ update auth.users set email = 'pgtap.author@gmail.com' where id = bxh_test.uid('author') $$,
  '42501', 'email domain not allowed',
  'changing the email to another domain is rejected'
);
select lives_ok(
  $$ update auth.users set email = 'pgtap.olivia@boxhero.test' where id = bxh_test.uid('author') $$,
  'changing the email within an allowed domain works'
);
select is(
  (select email from public.profiles where id = bxh_test.uid('author')),
  'pgtap.olivia@boxhero.test',
  'the profile email follows the auth email'
);

-- ---------- fail closed ----------
delete from private.allowed_email_domains;
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'pgtap.new@boxhero.test') $$,
  '42501', 'email domain not allowed',
  'with no allowed domain, nobody can sign up'
);
select lives_ok(
  $$ update auth.users set raw_user_meta_data = '{"full_name": "Olivia"}' where id = bxh_test.uid('author') $$,
  'existing users are not blocked by later domain changes (only email changes are checked)'
);
insert into private.allowed_email_domains (domain) values ('boxhero.test');

select throws_ok(
  $$ insert into private.allowed_email_domains (domain) values ('BoxHero.com') $$,
  '23514', null,
  'allowed domains must be lower case'
);
select throws_ok(
  $$ insert into private.allowed_email_domains (domain) values ('@boxhero.com') $$,
  '23514', null,
  'allowed domains are bare domains (no @)'
);
select throws_ok(
  $$ insert into private.bootstrap_admins (email) values ('Khalifa@boxhero.test') $$,
  '23514', null,
  'bootstrap admin emails must be lower case'
);

-- ---------- bootstrap admins ----------
select lives_ok(
  $$ insert into auth.users (id, email) values (bxh_test.uid('admin'), 'PGTAP.Admin@boxhero.test') $$,
  'a bootstrap admin signs up'
);
select ok(
  (select is_admin from public.profiles where id = bxh_test.uid('admin')),
  'a bootstrap admin gets is_admin on sign-up (email compared case-insensitively)'
);
insert into auth.users (id, email) values (bxh_test.uid('outsider'), 'pgtap.outsider@boxhero.test');
select ok(
  not (select is_admin from public.profiles where id = bxh_test.uid('outsider')),
  'a regular user is not admin'
);
insert into private.bootstrap_admins (email) values ('pgtap.outsider@boxhero.test');
select ok(
  (select is_admin from public.profiles where id = bxh_test.uid('outsider')),
  'adding a bootstrap admin later promotes the existing profile'
);

-- ---------- how Supabase Auth itself writes ----------
-- supabase_auth_admin cannot see pgTAP, so the role switch happens inside a helper.
create function bxh_test.try_as(p_role text, p_sql text) returns text language plpgsql as $$
declare
  v_result text := 'ok';
begin
  perform set_config('role', p_role, true);
  begin
    execute p_sql;
  exception when others then
    v_result := sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('role', 'none', true);
  return v_result;
end $$;

select is(
  bxh_test.try_as('supabase_auth_admin',
    $$ insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000aa', 'pgtap.gotrue@boxhero.test') $$),
  'ok',
  'inserting as supabase_auth_admin (the Auth server role) works'
);
select is(
  bxh_test.try_as('supabase_auth_admin',
    $$ insert into auth.users (id, email) values (gen_random_uuid(), 'pgtap.gotrue@example.com') $$),
  '42501: email domain not allowed',
  'and the domain check applies to it too'
);
select is(
  (select email from public.profiles where id = 'a0000000-0000-4000-8000-0000000000aa'),
  'pgtap.gotrue@boxhero.test',
  'the profile is created for a user inserted by the Auth server'
);

-- ---------- user deletion ----------
delete from auth.users where id = 'a0000000-0000-4000-8000-0000000000aa';
select is_empty(
  $$ select 1 from public.profiles where id = 'a0000000-0000-4000-8000-0000000000aa' $$,
  'deleting an auth user deletes the profile'
);
insert into public.memos (id, team, lang, title, author_id, decider_id)
values ('f0000000-0000-4000-8000-000000000001', 'ops', 'fr', 'Deletion', bxh_test.uid('author'), bxh_test.uid('decider'));
select throws_ok(
  $$ delete from auth.users where id = bxh_test.uid('author') $$,
  '23503', null,
  'an author with memos cannot be deleted (reassign or keep the account)'
);
delete from auth.users where id = bxh_test.uid('decider');
select is(
  (select decider_id from public.memos where id = 'f0000000-0000-4000-8000-000000000001'),
  null,
  'deleting a decision maker clears decider_id on their memos'
);
select is(
  (select count(*) from public.profiles where id = bxh_test.uid('decider')),
  0::bigint,
  'and removes their profile'
);

select * from finish();
rollback;
