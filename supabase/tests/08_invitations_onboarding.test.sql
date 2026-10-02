-- Invitations (who may sign in, managed by admins), the login form's check, and the
-- first sign-in (name + pôle).
begin;
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(36);

create schema bxh_test;
grant usage on schema bxh_test to public;

create function bxh_test.uid(p_name text) returns uuid language plpgsql immutable as $$
begin
  return case p_name
    when 'admin' then 'a0000000-0000-4000-8000-000000000081'
    when 'member' then 'a0000000-0000-4000-8000-000000000082'
    when 'guest' then 'a0000000-0000-4000-8000-000000000083'
    when 'placed' then 'a0000000-0000-4000-8000-000000000084'
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

create function bxh_test.rows(p_sql text) returns int language plpgsql as $$
declare
  v_rows int;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

create function bxh_test.teams(p_name text) returns text[] language sql security definer as $$
  select coalesce(array_agg(team::text order by team::text), '{}')
  from public.team_members where user_id = bxh_test.uid(p_name)
$$;

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.inv.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('admin'), 'pgtap.inv.admin@boxhero.test'),
  (bxh_test.uid('member'), 'pgtap.inv.member@boxhero.test');
insert into public.team_members (user_id, team) values (bxh_test.uid('member'), 'ops');

-- ---------- invitations: admins only ----------
call bxh_test.login('admin');
select lives_ok(
  $$ insert into public.invitations (email, team) values ('pgtap.guest@gmail.test', null), ('pgtap.placed@proton.test', 'finance') $$,
  'an admin invites people (with or without a pôle)'
);
select is(
  (select invited_by from public.invitations where email = 'pgtap.guest@gmail.test'),
  bxh_test.uid('admin'),
  'the invitation records who invited'
);
select throws_ok(
  $$ insert into public.invitations (email) values ('Upper@Gmail.test') $$,
  '23514', null,
  'invited addresses are stored in lower case'
);
select throws_ok(
  $$ insert into public.invitations (email, team) values ('pgtap.mini@gmail.test', 'mini') $$,
  '23514', null,
  'the ad mini memo is not a pôle to start in'
);
select is((select count(*)::int from public.invitations where email like 'pgtap.%'), 2, 'an admin reads the invitations');

call bxh_test.login('member');
select is_empty($$ select 1 from public.invitations $$, 'a member reads no invitation');
select throws_ok(
  $$ insert into public.invitations (email) values ('pgtap.friend@gmail.test') $$,
  '42501', null,
  'a member cannot invite'
);
select is(bxh_test.rows($$ delete from public.invitations where email = 'pgtap.guest@gmail.test' $$), 0,
  'a member cannot remove an invitation');
call bxh_test.anon();
select throws_ok($$ select 1 from public.invitations $$, '42501', null, 'anon cannot read invitations');

-- ---------- the login form's check ----------
call bxh_test.anon();
select ok(public.can_sign_in('pgtap.guest@gmail.test'), 'can_sign_in: an invited address');
select ok(public.can_sign_in('  PGTAP.Guest@Gmail.TEST '), 'can_sign_in ignores case and spaces');
select ok(public.can_sign_in('someone@boxhero.test'), 'can_sign_in: an allowed domain');
select ok(not public.can_sign_in('pgtap.stranger@gmail.test'), 'can_sign_in: anyone else is refused');
select ok(not public.can_sign_in(null), 'can_sign_in(null) is false');
select ok(not public.can_sign_in('not an email'), 'can_sign_in: not an address');

-- ---------- sign-up through an invitation ----------
call bxh_test.logout();
select lives_ok(
  $$ insert into auth.users (id, email) values (bxh_test.uid('guest'), 'pgtap.guest@gmail.test') $$,
  'an invited address can sign up (its domain is not allowed)'
);
select lives_ok(
  $$ insert into auth.users (id, email) values (bxh_test.uid('placed'), 'pgtap.placed@proton.test') $$,
  'another invited address can sign up'
);
select is(bxh_test.teams('placed'), array['finance'], 'an invitation with a pôle puts the person in it');
select is(bxh_test.teams('guest'), '{}'::text[], 'an invitation without a pôle puts them in none');
select throws_ok(
  $$ insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000ff', 'pgtap.stranger@gmail.test') $$,
  '42501', 'email domain not allowed',
  'someone not invited still cannot sign up'
);

-- Removing an invitation also clears the older SQL-only list.
insert into private.allowed_emails (email) values ('pgtap.legacy@proton.test');
insert into public.invitations (email) values ('pgtap.legacy@proton.test');
call bxh_test.login('admin');
select is(bxh_test.rows($$ delete from public.invitations where email = 'pgtap.legacy@proton.test' $$), 1,
  'an admin removes an invitation');
call bxh_test.anon();
select ok(not public.can_sign_in('pgtap.legacy@proton.test'), 'removed: that address can no longer sign up');
call bxh_test.logout();

-- An account keeps signing in after its invitation is removed.
delete from public.invitations where email = 'pgtap.placed@proton.test';
call bxh_test.anon();
select ok(public.can_sign_in('pgtap.placed@proton.test'), 'can_sign_in: an existing account');

-- ---------- first sign-in ----------
call bxh_test.login('guest');
select is((select onboarded_at from public.profiles where id = bxh_test.uid('guest')), null, 'a new profile is not set up yet');
select throws_ok(
  $$ select public.complete_onboarding('Gus Guest', null) $$,
  '23514', 'a pôle is required',
  'someone in no pôle must choose one'
);
select throws_ok(
  $$ select public.complete_onboarding('   ', 'ops') $$,
  '23514', 'a name is required',
  'a name is required'
);
select lives_ok($$ select public.complete_onboarding('  Gus Guest ', 'growth') $$, 'name + pôle: done');
select is(bxh_test.teams('guest'), array['growth'], 'the chosen pôle');
select is(
  (select full_name from public.profiles where id = bxh_test.uid('guest')),
  'Gus Guest',
  'the name, trimmed'
);
select lives_ok($$ select public.complete_onboarding('Other Name', 'finance') $$, 'a second call does nothing (no error)');
select is(bxh_test.teams('guest'), array['growth'], 'the pôle cannot be changed this way afterwards');
select throws_ok(
  $$ update public.profiles set onboarded_at = null where id = bxh_test.uid('guest') $$,
  '42501', null,
  'nobody resets their own first sign-in (to pick a pôle again)'
);
select lives_ok(
  $$ update public.profiles set full_name = 'Gus G.' where id = bxh_test.uid('guest') $$,
  'the name stays editable'
);

call bxh_test.login('placed');
select lives_ok($$ select public.complete_onboarding('Paula Placed', 'ops') $$, 'someone already in a pôle only gives a name');
select is(bxh_test.teams('placed'), array['finance'], 'their pôle stays the one they were given');

call bxh_test.login('admin');
select lives_ok($$ select public.complete_onboarding('Ada Admin', null) $$, 'an admin may skip the pôle');

select * from finish();
rollback;
