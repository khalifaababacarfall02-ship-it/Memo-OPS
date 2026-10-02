-- Access codes and passwords: admins issue a one-time code, the person chooses their
-- password with it (account created or password changed), wrong tries are counted.
begin;
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(29);

create schema bxh_test;
grant usage on schema bxh_test to public;

create function bxh_test.uid(p_name text) returns uuid language plpgsql immutable as $$
begin
  return case p_name
    when 'admin' then 'a0000000-0000-4000-8000-0000000000a1'
    when 'member' then 'a0000000-0000-4000-8000-0000000000a2'
    else null
  end::uuid;
end $$;

create procedure bxh_test.login(p_name text) language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', bxh_test.uid(p_name), 'role', 'authenticated')::text, true);
end $$;

create procedure bxh_test.anon() language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create procedure bxh_test.logout() language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;

-- The code issued by the admin, kept for the next steps (as the trusted runner).
create table bxh_test.codes (email text primary key, code text);
grant all on bxh_test.codes to public;

-- ---------- fixtures ----------
insert into private.bootstrap_admins (email) values ('pgtap.code.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('admin'), 'pgtap.code.admin@boxhero.test'),
  (bxh_test.uid('member'), 'pgtap.code.member@boxhero.test');
insert into public.invitations (email, team) values ('pgtap.newbie@gmail.test', 'sav');

-- ---------- issuing ----------
call bxh_test.login('member');
select throws_ok(
  $$ select public.issue_access_code('pgtap.newbie@gmail.test') $$,
  '42501', 'only an admin can give an access code',
  'a member cannot issue a code'
);
call bxh_test.anon();
select throws_ok(
  $$ select public.issue_access_code('pgtap.newbie@gmail.test') $$,
  '42501', null,
  'anon cannot issue a code'
);

call bxh_test.login('admin');
select throws_ok(
  $$ select public.issue_access_code('stranger@gmail.test') $$,
  '23514', 'invite this address first',
  'no code for an address that is not invited'
);
insert into bxh_test.codes values ('pgtap.newbie@gmail.test', public.issue_access_code(' PGTAP.Newbie@gmail.test '));
select matches((select code from bxh_test.codes where email = 'pgtap.newbie@gmail.test'),
  '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$', 'a code looks like XXXX-XXXX, without look-alike characters');
insert into bxh_test.codes values ('pgtap.code.member@boxhero.test', public.issue_access_code('pgtap.code.member@boxhero.test'));
select ok(true, 'a code can be issued for an existing account (forgotten password)');

call bxh_test.logout();
select isnt((select code_hash from private.access_codes where email = 'pgtap.newbie@gmail.test'),
  (select code from bxh_test.codes where email = 'pgtap.newbie@gmail.test'),
  'only a hash of the code is stored');
select ok((select expires_at from private.access_codes where email = 'pgtap.newbie@gmail.test') > now() + interval '6 days',
  'a code is valid a week');
call bxh_test.login('member');
select throws_ok($$ select 1 from private.access_codes $$, '42501', null, 'nobody reads the codes');

-- ---------- choosing a password ----------
call bxh_test.anon();
select is(public.set_password_with_code('pgtap.newbie@gmail.test', (select code from bxh_test.codes where email = 'pgtap.newbie@gmail.test'), 'short'),
  'weak', 'a password needs at least 8 characters');
select is(public.set_password_with_code('pgtap.newbie@gmail.test', 'AAAA-AAAA', 'long enough pw'),
  'invalid', 'a wrong code is refused');
select is(public.set_password_with_code('nobody@gmail.test', 'AAAA-AAAA', 'long enough pw'),
  'invalid', 'an unknown address gets the same answer');
call bxh_test.logout();
select is((select attempts from private.access_codes where email = 'pgtap.newbie@gmail.test'), 1, 'the wrong try is counted');

call bxh_test.anon();
select is(
  public.set_password_with_code(' PGTAP.newbie@gmail.test', lower(replace((select code from bxh_test.codes where email = 'pgtap.newbie@gmail.test'), '-', ' ')), 'Correct horse 42'),
  'ok', 'the right code (any case, any separator) sets the password'
);
call bxh_test.logout();
select is((select count(*)::int from auth.users where email = 'pgtap.newbie@gmail.test'), 1, 'the account is created');
select ok((select email_confirmed_at is not null and aud = 'authenticated' and role = 'authenticated'
           from auth.users where email = 'pgtap.newbie@gmail.test'), 'confirmed, with the Supabase Auth audience and role');
select ok((select encrypted_password = extensions.crypt('Correct horse 42', encrypted_password) and encrypted_password like '$2a$10$%'
           from auth.users where email = 'pgtap.newbie@gmail.test'), 'the password is stored as a bcrypt hash (cost 10)');
select is((select identity_data ->> 'email' from auth.identities i join auth.users u on u.id = i.user_id
           where u.email = 'pgtap.newbie@gmail.test' and i.provider = 'email'),
  'pgtap.newbie@gmail.test', 'with an email identity');
select is((select confirmation_token || recovery_token || email_change_token_new || email_change
           from auth.users where email = 'pgtap.newbie@gmail.test'), '', 'token columns are empty strings, as Supabase Auth expects');
select ok(exists (select 1 from public.profiles where email = 'pgtap.newbie@gmail.test'), 'the profile is created');
select is((select array_agg(tm.team::text) from public.team_members tm join public.profiles p on p.id = tm.user_id
           where p.email = 'pgtap.newbie@gmail.test'), array['sav'], 'in the pôle of the invitation');
select is_empty($$ select 1 from private.access_codes where email = 'pgtap.newbie@gmail.test' $$, 'the code is burnt');
call bxh_test.anon();
select is(public.set_password_with_code('pgtap.newbie@gmail.test', (select code from bxh_test.codes where email = 'pgtap.newbie@gmail.test'), 'Another one 42'),
  'invalid', 'a code works once');

-- ---------- forgotten password ----------
select is(public.set_password_with_code('pgtap.code.member@boxhero.test', (select code from bxh_test.codes where email = 'pgtap.code.member@boxhero.test'), 'New secret 99'),
  'ok', 'an existing account gets a new password');
call bxh_test.logout();
select ok((select encrypted_password = extensions.crypt('New secret 99', encrypted_password) from auth.users where id = bxh_test.uid('member')),
  'the new password is stored');
select is((select count(*)::int from auth.users where lower(email) = 'pgtap.code.member@boxhero.test'), 1, 'no second account');

-- ---------- lock and expiry ----------
call bxh_test.login('admin');
insert into bxh_test.codes values ('pgtap.locked@gmail.test', null);
insert into public.invitations (email) values ('pgtap.locked@gmail.test');
update bxh_test.codes set code = public.issue_access_code('pgtap.locked@gmail.test') where email = 'pgtap.locked@gmail.test';
call bxh_test.anon();
select is(public.set_password_with_code('pgtap.locked@gmail.test', 'BBBB-BBBB', 'long enough pw'), 'invalid', 'try 1');
do $$
begin
  for i in 2..5 loop
    perform public.set_password_with_code('pgtap.locked@gmail.test', 'BBBB-BBBB', 'long enough pw');
  end loop;
end
$$;
select is(public.set_password_with_code('pgtap.locked@gmail.test', (select code from bxh_test.codes where email = 'pgtap.locked@gmail.test'), 'long enough pw'),
  'locked', 'after 5 wrong tries even the right code is refused');
call bxh_test.login('admin');
update bxh_test.codes set code = public.issue_access_code('pgtap.locked@gmail.test') where email = 'pgtap.locked@gmail.test';
call bxh_test.logout();
update private.access_codes set expires_at = now() - interval '1 minute' where email = 'pgtap.locked@gmail.test';
call bxh_test.anon();
select is(public.set_password_with_code('pgtap.locked@gmail.test', (select code from bxh_test.codes where email = 'pgtap.locked@gmail.test'), 'long enough pw'),
  'expired', 'an old code is refused');
call bxh_test.logout();
select ok(not exists (select 1 from auth.users where email = 'pgtap.locked@gmail.test'), 'and no account was made');

select * from finish();
rollback;
