-- memos.search_text: lower-case, accent-free title + every string of content (except
-- ids and the memo kind), kept up to date by the memos_search_text trigger.
begin;
-- pgTAP: installed by `supabase test db` and scripts/db-test.sh (possibly as plain SQL).
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(20);

-- ---------- helpers (rolled back with the transaction) ----------
create schema bxh_test;
grant usage on schema bxh_test to public;

create function bxh_test.uid(p_name text) returns uuid language plpgsql immutable as $$
begin
  return case p_name
    when 'author' then 'a0000000-0000-4000-8000-000000000002'
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

create procedure bxh_test.logout() language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;

-- What the app does to the search box input before `search_text ilike '%…%'`.
create function bxh_test.q(p_text text) returns text language sql stable as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text))
$$;

create function bxh_test.search_text(p_n int) returns text language sql stable as $$
  select search_text from public.memos where id = bxh_test.memo(p_n)
$$;

create function bxh_test.explain(p_sql text) returns text language plpgsql as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain (costs off) ' || p_sql loop
    v_plan := v_plan || v_line || e'\n';
  end loop;
  return v_plan;
end $$;

-- ---------- fixtures ----------
insert into private.allowed_email_domains (domain) values ('boxhero.test') on conflict do nothing;
insert into auth.users (id, email) values
  (bxh_test.uid('author'), 'pgtap.author@boxhero.test'),
  (bxh_test.uid('loner'), 'pgtap.loner@boxhero.test');
insert into public.team_members (user_id, team) values (bxh_test.uid('author'), 'ops');

call bxh_test.login('author');
insert into public.memos (id, team, lang, title, content) values (
  bxh_test.memo(1), 'ops', 'fr', 'Décision : ÉTÉ 2026',
  $json${
    "kind": "memo",
    "author": "Mattéo",
    "meta": ["Khalifa", "Mattéo", "28 septembre 2026", "Réétiqueter le stock"],
    "s": ["Les retours sont à 31 %", "Le cœur du problème", "Étapes :\n1) Flatfee confirme\n\n2) AMZ Boost", "Je propose"],
    "acts": [{"id": "act-7f3a", "action": "Relancer Flatfee", "owner": "Lukas", "due": "2 octobre"}],
    "needs": [{"id": "need-9c1d", "done": true, "text": "Accord budgétaire"}],
    "res": "Retours sous 12 %",
    "qs": [{"id": "q-5e2b", "q": "On réétiquette ?"}],
    "extra": {"deep": {"deeper": ["Niveau profond"]}}
  }$json$
);
call bxh_test.logout();

-- ---------- what goes in ----------
select is(bxh_test.search_text(1), lower(bxh_test.search_text(1)), 'search_text is lower case');
select ok(bxh_test.search_text(1) !~ '[^\x01-\x7e]', 'search_text has no accents left (French text becomes ASCII)');
select ok(position('decision : ete 2026' in bxh_test.search_text(1)) = 1, 'it starts with the title');
select ok(position('reetiqueter le stock' in bxh_test.search_text(1)) > 0, 'it contains the header fields');
select ok(position('le coeur du probleme' in bxh_test.search_text(1)) > 0, 'ligatures are spelled out (œ -> oe)');
select ok(position('relancer flatfee' in bxh_test.search_text(1)) > 0 and position('lukas' in bxh_test.search_text(1)) > 0,
  'it contains the action rows');
select ok(position('accord budgetaire' in bxh_test.search_text(1)) > 0, 'it contains the requests');
select ok(position('on reetiquette ?' in bxh_test.search_text(1)) > 0, 'it contains the questions');
select ok(position('niveau profond' in bxh_test.search_text(1)) > 0, 'it walks nested objects and arrays');
select ok(
  position('act-7f3a' in bxh_test.search_text(1)) = 0
  and position('need-9c1d' in bxh_test.search_text(1)) = 0
  and position('q-5e2b' in bxh_test.search_text(1)) = 0,
  'row ids are left out'
);
select ok(position('memo' in bxh_test.search_text(1)) = 0 and position('true' in bxh_test.search_text(1)) = 0,
  'the memo kind and non-string values are left out');
select ok(bxh_test.search_text(1) !~ '\s\s|\n', 'whitespace is collapsed to single spaces');

-- ---------- searching ----------
call bxh_test.login('author');
select is(
  (select count(*) from public.memos where search_text ilike '%' || bxh_test.q('RÉÉTIQUET') || '%'),
  1::bigint,
  'a search with accents and capitals finds the memo'
);
select is(
  (select count(*) from public.memos where search_text ilike '%' || bxh_test.q('etapes') || '%'),
  1::bigint,
  'a search without accents finds accented text'
);
call bxh_test.login('loner');
select is(
  (select count(*) from public.memos where search_text ilike '%' || bxh_test.q('reetiquet') || '%'),
  0::bigint,
  'search only finds memos the user may read'
);

-- ---------- kept up to date, never written by clients ----------
call bxh_test.login('author');
update public.memos set content = jsonb_set(content, '{s,0}', '"Nouvelle donne"') where id = bxh_test.memo(1);
select ok(
  position('nouvelle donne' in bxh_test.search_text(1)) > 0
  and position('les retours sont' in bxh_test.search_text(1)) = 0,
  'editing the content updates search_text'
);
update public.memos set title = 'Titre changé' where id = bxh_test.memo(1);
select ok(position('titre change' in bxh_test.search_text(1)) = 1, 'editing the title updates search_text');
update public.memos set search_text = 'hacked' where id = bxh_test.memo(1);
select ok(position('titre change' in bxh_test.search_text(1)) = 1, 'a client cannot overwrite search_text');
insert into public.memos (id, team, lang, title, search_text) values (bxh_test.memo(2), 'ops', 'fr', '', 'hacked');
select is(bxh_test.search_text(2), '', 'nor set it on insert (an empty memo has an empty search_text)');
call bxh_test.logout();

-- ---------- the trigram index serves the search ----------
set local enable_seqscan = off;
select ok(
  bxh_test.explain($$ select id from public.memos where search_text ilike '%reetiq%' $$)
    like '%memos_search_text_trgm_idx%',
  'the trigram index can serve an ilike search'
);
reset enable_seqscan;

select * from finish();
rollback;
