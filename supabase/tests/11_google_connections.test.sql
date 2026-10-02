-- Google Calendar connections: the owner only (admins included cannot read them).
begin;
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(8);

create schema bxh_test;
grant usage on schema bxh_test to public;

create function bxh_test.uid(p_name text) returns uuid language plpgsql immutable as $$
begin
  return case p_name
    when 'admin' then 'a0000000-0000-4000-8000-0000000000b1'
    when 'owner' then 'a0000000-0000-4000-8000-0000000000b2'
    else null
  end::uuid;
end $$;

create procedure bxh_test.login(p_name text) language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', bxh_test.uid(p_name), 'role', 'authenticated')::text, true);
end $$;

create function bxh_test.rows(p_sql text) returns int language plpgsql as $$
declare
  v_rows int;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.g.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('admin'), 'pgtap.g.admin@boxhero.test'),
  (bxh_test.uid('owner'), 'pgtap.g.owner@boxhero.test');

call bxh_test.login('owner');
select lives_ok(
  $$ insert into public.google_connections (google_email, refresh_token, scope)
     values ('owner@gmail.com', 'v1.aaaa.bbbb.cccc', 'openid email https://www.googleapis.com/auth/calendar.events.readonly') $$,
  'a person connects their Google account'
);
select is((select user_id from public.google_connections), bxh_test.uid('owner'), 'for themselves');
select throws_ok(
  $$ update public.google_connections set refresh_token = 'plain-token' $$,
  '23514', null,
  'only an encrypted token is stored'
);
select throws_ok(
  $$ insert into public.google_connections (user_id, google_email, refresh_token) values (bxh_test.uid('admin'), 'x@gmail.com', 'v1.a.b.c') $$,
  '42501', null,
  'not for someone else'
);

call bxh_test.login('admin');
select is_empty($$ select 1 from public.google_connections $$, 'an admin cannot read anyone''s connection');
select is(bxh_test.rows($$ delete from public.google_connections $$), 0, 'nor delete it');

call bxh_test.login('owner');
select is(bxh_test.rows($$ delete from public.google_connections $$), 1, 'the owner disconnects');
select ok(not has_table_privilege('anon', 'public.google_connections', 'select'), 'anon reads nothing');

select * from finish();
rollback;
