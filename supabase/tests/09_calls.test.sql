-- The people of a memo's call (who reads, who adds), the call itself, calendar links,
-- and a memo prepared from a calendar event.
begin;
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(34);

create schema bxh_test;
grant usage on schema bxh_test to public;

create function bxh_test.uid(p_name text) returns uuid language plpgsql immutable as $$
begin
  return case p_name
    when 'admin' then 'a0000000-0000-4000-8000-000000000091'
    when 'author' then 'a0000000-0000-4000-8000-000000000092'
    when 'guest' then 'a0000000-0000-4000-8000-000000000093'
    when 'other' then 'a0000000-0000-4000-8000-000000000094'
    else null
  end::uuid;
end $$;

create function bxh_test.memo(p_n int) returns uuid language sql immutable as $$
  select ('f9000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
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

create function bxh_test.rows(p_sql text) returns int language plpgsql as $$
declare
  v_rows int;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

create function bxh_test.visible() returns text[] language sql as $$
  select coalesce(array_agg(title order by title), '{}')
  from public.memos where id::text like 'f9000000-%'
$$;

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into private.bootstrap_admins (email) values ('pgtap.call.admin@boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('admin'), 'pgtap.call.admin@boxhero.test'),
  (bxh_test.uid('author'), 'pgtap.call.author@boxhero.test'),   -- ops
  (bxh_test.uid('guest'), 'pgtap.call.guest@boxhero.test'),     -- growth
  (bxh_test.uid('other'), 'pgtap.call.other@boxhero.test');     -- growth
insert into public.team_members (user_id, team) values
  (bxh_test.uid('author'), 'ops'),
  (bxh_test.uid('guest'), 'growth'),
  (bxh_test.uid('other'), 'growth');
insert into public.memos (id, team, lang, title, author_id, status) values
  (bxh_test.memo(1), 'ops', 'fr', 'call-draft', bxh_test.uid('author'), 'draft'),
  (bxh_test.memo(2), 'ops', 'fr', 'call-decided', bxh_test.uid('author'), 'draft');
update public.memos set status = 'decided' where id = bxh_test.memo(2);
insert into public.memo_answers (memo_id, question_id, answer, answered_by)
  values (bxh_test.memo(1), 'q1', 'an answer', bxh_test.uid('admin'));

-- ---------- participants ----------
call bxh_test.login('guest');
select is(bxh_test.visible(), '{}'::text[], 'someone from another pôle does not see the memo');

call bxh_test.login('author');
select lives_ok(
  $$ insert into public.memo_participants (memo_id, email) values (bxh_test.memo(1), 'pgtap.call.guest@boxhero.test') $$,
  'the author adds someone to the call'
);
select is(
  (select added_by from public.memo_participants where memo_id = bxh_test.memo(1)),
  bxh_test.uid('author'),
  'added_by is the caller'
);
select lives_ok(
  $$ insert into public.memo_participants (memo_id, email) values (bxh_test.memo(1), 'not.signed.up@gmail.test') $$,
  'someone who never signed in can be added (by email)'
);
select throws_ok(
  $$ insert into public.memo_participants (memo_id, email) values (bxh_test.memo(1), 'Mixed@Case.test') $$,
  '23514', null,
  'emails are stored in lower case'
);
select throws_ok(
  $$ insert into public.memo_participants (memo_id, email) values (bxh_test.memo(2), 'pgtap.call.other@boxhero.test') $$,
  '42501', null,
  'nobody is added once the memo is decided'
);

call bxh_test.login('guest');
select is(bxh_test.visible(), array['call-draft'], 'a participant sees the memo');
select is(
  (select array_agg(email order by email) from public.memo_participants where memo_id = bxh_test.memo(1)),
  array['not.signed.up@gmail.test', 'pgtap.call.guest@boxhero.test'],
  'and who else is in the call'
);
select is(
  (select answer from public.memo_answers where memo_id = bxh_test.memo(1)),
  'an answer',
  'and the answers'
);
select is(bxh_test.rows($$ update public.memos set title = 'hijack' where id = bxh_test.memo(1) $$), 0,
  'a participant cannot edit the memo');
select throws_ok(
  $$ insert into public.memo_participants (memo_id, email) values (bxh_test.memo(1), 'pgtap.call.other@boxhero.test') $$,
  '42501', null,
  'a participant cannot add people'
);
select is(bxh_test.rows($$ delete from public.memo_participants where memo_id = bxh_test.memo(1) $$), 0,
  'nor remove them');

call bxh_test.login('other');
select is(bxh_test.visible(), '{}'::text[], 'a teammate of the participant does not see it');
select is_empty($$ select 1 from public.memo_participants where memo_id = bxh_test.memo(1) $$,
  'nor who is in the call');

call bxh_test.login('author');
select is(bxh_test.rows($$ delete from public.memo_participants
  where memo_id = bxh_test.memo(1) and email = 'pgtap.call.guest@boxhero.test' $$), 1,
  'the author removes someone');
call bxh_test.login('guest');
select is(bxh_test.visible(), '{}'::text[], 'removed: the memo is hidden again');

-- At most 50 people.
call bxh_test.logout();
insert into public.memo_participants (memo_id, email)
select bxh_test.memo(1), 'p' || g || '@many.test' from generate_series(1, 49) g;
call bxh_test.login('author');
select throws_ok(
  $$ insert into public.memo_participants (memo_id, email) values (bxh_test.memo(1), 'one.more@many.test') $$,
  '23514', 'too many participants',
  'a call has at most 50 people'
);
call bxh_test.logout();
delete from public.memo_participants where email like '%@many.test';

-- ---------- the call ----------
call bxh_test.login('author');
select lives_ok(
  $$ insert into public.memo_calls (memo_id, starts_at, event_id) values (bxh_test.memo(1), '2026-10-05 09:00+00', 'evt-1') $$,
  'the author sets the call'
);
select is(
  (select updated_at from public.memos where id = bxh_test.memo(1)) < now() + interval '1 day'
    and (select title from public.memos where id = bxh_test.memo(1)) = 'call-draft',
  true,
  'the memo itself is untouched'
);
select is(bxh_test.rows($$ update public.memo_calls set starts_at = '2026-10-06 09:00+00' where memo_id = bxh_test.memo(1) $$), 1,
  'and moves it');
call bxh_test.login('other');
select is(bxh_test.rows($$ update public.memo_calls set starts_at = now() where memo_id = bxh_test.memo(1) $$), 0,
  'nobody else changes it');
select is_empty($$ select 1 from public.memo_calls $$, 'nor sees it without seeing the memo');

-- ---------- calendar links ----------
call bxh_test.login('guest');
select lives_ok(
  $$ insert into public.calendar_links (url) values ('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics') $$,
  'a person saves their calendar link'
);
select throws_ok(
  $$ insert into public.calendar_links (user_id, url) values (bxh_test.uid('other'), 'https://calendar.google.com/x.ics') $$,
  '42501', null,
  'only for themselves'
);
select throws_ok(
  $$ update public.calendar_links set url = 'http://insecure.test/x.ics' $$,
  '23514', null,
  'https only'
);
call bxh_test.login('admin');
select is_empty($$ select 1 from public.calendar_links $$, 'an admin cannot read anyone''s calendar link');
call bxh_test.login('other');
select is(bxh_test.rows($$ delete from public.calendar_links $$), 0, 'nor can anyone else delete it');

-- ---------- a memo prepared from a calendar event ----------
call bxh_test.login('author');
select lives_ok(
  $$ select public.create_call_memo('ops', 'fr', 'Weekly ops', '{"kind":"memo"}', '2026-10-07 08:00+00', 'evt-2',
       array['pgtap.call.guest@boxhero.test', ' PGTAP.Call.Other@boxhero.test ', 'bad address', 'pgtap.call.guest@boxhero.test']) $$,
  'create_call_memo creates a memo from an event'
);
select is(
  (select array_agg(mp.email order by mp.email)
   from public.memo_participants mp join public.memo_calls c using (memo_id)
   where c.event_id = 'evt-2'),
  array['pgtap.call.guest@boxhero.test', 'pgtap.call.other@boxhero.test'],
  'with its people (valid, lower case, once each)'
);
select is(
  (select m.status::text || ' ' || m.title || ' ' || (m.author_id = bxh_test.uid('author'))::text
   from public.memos m join public.memo_calls c on c.memo_id = m.id where c.event_id = 'evt-2'),
  'draft Weekly ops true',
  'as the caller''s draft'
);
select is(
  public.create_call_memo('ops', 'fr', 'Again', '{}', null, 'evt-2', null),
  (select memo_id from public.memo_calls where event_id = 'evt-2'),
  'the same event again opens the same memo'
);
call bxh_test.login('other');
select is(bxh_test.visible(), '{}'::text[], 'other is still blind to the first memo');
select is(
  (select count(*)::int from public.memos m join public.memo_calls c on c.memo_id = m.id where c.event_id = 'evt-2'),
  1,
  'but sees the memo of the call they are in'
);
call bxh_test.login('guest');
select throws_ok(
  $$ select public.create_call_memo('ops', 'fr', 'Not my pôle', '{}', null, 'evt-3', null) $$,
  '42501', null,
  'create_call_memo follows the insert rules (own pôles only)'
);

select * from finish();
rollback;
