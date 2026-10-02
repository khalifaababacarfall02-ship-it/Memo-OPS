-- Sign-up allow-list by exact address (private.allowed_emails).
begin;
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(7);

insert into private.allowed_emails (email) values ('pgtap.solo@proton.test'), ('pgtap.mixed@proton.test');

select lives_ok(
  $$ insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000e1', 'pgtap.solo@proton.test') $$,
  'an exact allowed address can sign up although its domain is not allowed'
);
select is(
  (select email from public.profiles where id = 'a0000000-0000-4000-8000-0000000000e1'),
  'pgtap.solo@proton.test',
  'and gets a profile'
);
select lives_ok(
  $$ insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000e2', '  PgTap.Mixed@Proton.TEST ') $$,
  'the exact match ignores case and surrounding spaces'
);
select throws_ok(
  $$ insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000e3', 'pgtap.other@proton.test') $$,
  '42501', 'email domain not allowed',
  'another address on the same domain is refused'
);
select throws_ok(
  $$ insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000e4', 'pgtap.solo@proton.test.evil.example') $$,
  '42501', 'email domain not allowed',
  'a look-alike address is refused'
);
select throws_ok(
  $$ insert into private.allowed_emails (email) values ('Not.Lower@proton.test') $$,
  '23514', null,
  'entries must be lower case'
);
select ok(
  not has_table_privilege('authenticated', 'private.allowed_emails', 'select'),
  'signed-in users cannot read the list'
);

select * from finish();
rollback;
