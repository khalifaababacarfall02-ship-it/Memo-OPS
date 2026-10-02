-- Structure and privileges: what exists, what RLS covers, who may touch what.
-- Run: npm run db:test (plain Postgres) or supabase test db (local Supabase).
begin;
-- pgTAP: installed by `supabase test db` and scripts/db-test.sh (possibly as plain SQL).
do $$
begin
  if to_regprocedure('extensions.plan(integer)') is null then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;
select plan(73);

-- ---------- extensions and types ----------
select has_extension('extensions', 'pg_trgm', 'pg_trgm lives in schema extensions');
select has_extension('extensions', 'unaccent', 'unaccent lives in schema extensions');
select enum_has_labels('public', 'team_key', array['ops', 'growth', 'crea', 'sav', 'finance', 'mini'], 'team_key = the six pills');
select enum_has_labels('public', 'memo_lang', array['fr', 'en'], 'memo_lang = fr | en');
select enum_has_labels('public', 'memo_status', array['draft', 'to_decide', 'decided', 'archived'], 'memo_status = the four statuses');

-- ---------- tables ----------
select tables_are('public',
  array['profiles', 'team_members', 'memos', 'memo_answers', 'invitations', 'memo_participants', 'memo_calls', 'calendar_links'],
  'public has exactly the eight app tables');
select tables_are('private', array['allowed_email_domains', 'allowed_emails', 'bootstrap_admins'], 'private has the three configuration tables');
select columns_are('public', 'memos',
  array['id', 'team', 'lang', 'title', 'author_id', 'decider_id', 'status', 'content', 'asana_task_gid',
        'search_text', 'decided_at', 'created_at', 'updated_at'],
  'memos has the documented columns');
select columns_are('public', 'profiles',
  array['id', 'email', 'full_name', 'is_admin', 'asana_user_gid', 'created_at', 'updated_at', 'onboarded_at'],
  'profiles has the documented columns');
select columns_are('public', 'memo_answers',
  array['memo_id', 'question_id', 'answer', 'answered_by', 'created_at', 'updated_at'],
  'memo_answers has the documented columns');
select col_type_is('public', 'memos', 'content', 'jsonb', 'memos.content is jsonb');
select col_is_pk('public', 'team_members', array['user_id', 'team'], 'team_members PK is (user_id, team)');
select col_is_pk('public', 'memo_answers', array['memo_id', 'question_id'], 'memo_answers PK is (memo_id, question_id)');
select col_is_pk('public', 'memo_participants', array['memo_id', 'email'], 'memo_participants PK is (memo_id, email)');
select col_is_pk('public', 'memo_calls', 'memo_id', 'memo_calls PK is memo_id (one call per memo)');
select col_is_pk('public', 'calendar_links', 'user_id', 'calendar_links PK is user_id (one link per person)');
select col_is_pk('public', 'invitations', 'email', 'invitations PK is email');

-- FK names are what src/lib/database.types.ts declares (supabase-js embeds use them).
select results_eq(
  $$ select (conrelid::regclass::text || '.' || conname::text) collate "default" from pg_constraint
     where contype = 'f' and connamespace = 'public'::regnamespace order by 1 $$,
  array[
    'calendar_links.calendar_links_user_id_fkey',
    'invitations.invitations_invited_by_fkey',
    'memo_answers.memo_answers_answered_by_fkey',
    'memo_answers.memo_answers_memo_id_fkey',
    'memo_calls.memo_calls_memo_id_fkey',
    'memo_participants.memo_participants_added_by_fkey',
    'memo_participants.memo_participants_memo_id_fkey',
    'memos.memos_author_id_fkey',
    'memos.memos_decider_id_fkey',
    'profiles.profiles_id_fkey',
    'team_members.team_members_user_id_fkey'
  ],
  'foreign keys have the names the TypeScript types use'
);
select results_eq(
  $$ select (conname::text || ' ' || confdeltype::text) collate "default" from pg_constraint
     where contype = 'f' and connamespace = 'public'::regnamespace order by 1 $$,
  array[
    'calendar_links_user_id_fkey c',
    'invitations_invited_by_fkey n',
    'memo_answers_answered_by_fkey r',
    'memo_answers_memo_id_fkey c',
    'memo_calls_memo_id_fkey c',
    'memo_participants_added_by_fkey n',
    'memo_participants_memo_id_fkey c',
    'memos_author_id_fkey r',
    'memos_decider_id_fkey n',
    'profiles_id_fkey c',
    'team_members_user_id_fkey c'
  ],
  'delete rules: answers/profiles/memberships/calls cascade, authors restrict, deciders and inviters set null'
);

-- ---------- indexes ----------
select has_index('public', 'memos', 'memos_team_status_updated_idx', array['team', 'status', 'updated_at'], 'index for the list (team, status, updated_at)');
select has_index('public', 'memos', 'memos_author_updated_idx', array['author_id', 'updated_at'], 'index for "my memos"');
select has_index('public', 'memos', 'memos_decider_status_idx', array['decider_id', 'status'], 'index for "waiting for my decision"');
select index_is_type('public', 'memos', 'memos_search_text_trgm_idx', 'gin', 'search_text has a GIN index');
select is(
  (select o.opcnamespace::regnamespace::text || '.' || o.opcname::text
   from pg_index i join pg_opclass o on o.oid = i.indclass[0]
   where i.indexrelid = 'public.memos_search_text_trgm_idx'::regclass),
  'extensions.gin_trgm_ops',
  'the search index uses trigram ops'
);

-- ---------- row level security ----------
select is_empty(
  $$ select relname from pg_class
     where relnamespace in ('public'::regnamespace, 'private'::regnamespace) and relkind = 'r' and not relrowsecurity $$,
  'RLS is enabled on every table of public and private'
);
select policies_are('public', 'profiles', array['profiles_select', 'profiles_update'], 'profiles policies');
select policies_are('public', 'team_members', array['team_members_select', 'team_members_insert', 'team_members_delete'], 'team_members policies');
select policies_are('public', 'memos', array['memos_select', 'memos_insert', 'memos_update', 'memos_delete'], 'memos policies');
select policies_are('public', 'memo_answers',
  array['memo_answers_select', 'memo_answers_insert', 'memo_answers_update', 'memo_answers_delete'], 'memo_answers policies');
select policies_are('public', 'invitations', array['invitations_admin'], 'invitations policy (admins only)');
select policies_are('public', 'memo_participants',
  array['memo_participants_select', 'memo_participants_insert', 'memo_participants_delete'], 'memo_participants policies');
select policies_are('public', 'memo_calls',
  array['memo_calls_select', 'memo_calls_insert', 'memo_calls_update', 'memo_calls_delete'], 'memo_calls policies');
select policies_are('public', 'calendar_links', array['calendar_links_own'], 'calendar_links policy (owner only)');
select is_empty(
  $$ select policyname from pg_policies where schemaname in ('public', 'private') and roles <> '{authenticated}' $$,
  'every policy is for authenticated only'
);
select is_empty(
  $$ select policyname from pg_policies, lateral (select coalesce(qual, '') || ' ' || coalesce(with_check, '') as txt) p
     where schemaname = 'public'
       and regexp_count(p.txt, 'auth\.uid\(\)') <> regexp_count(p.txt, 'SELECT auth\.uid\(\)') $$,
  'policies wrap every auth.uid() in a subquery (evaluated once per statement)'
);

-- ---------- table privileges ----------
select table_privs_are('public', 'profiles', 'anon', array[]::text[], 'anon: nothing on profiles');
select table_privs_are('public', 'team_members', 'anon', array[]::text[], 'anon: nothing on team_members');
select table_privs_are('public', 'memos', 'anon', array[]::text[], 'anon: nothing on memos');
select table_privs_are('public', 'memo_answers', 'anon', array[]::text[], 'anon: nothing on memo_answers');
select is_empty(
  $$ select t from unnest(array['public.invitations', 'public.memo_participants', 'public.memo_calls', 'public.calendar_links']) t
     where has_table_privilege('anon', t, 'SELECT, INSERT, UPDATE, DELETE') $$,
  'anon: nothing on invitations, participants, calls, calendar links'
);
select table_privs_are('public', 'memo_participants', 'authenticated', array['SELECT', 'INSERT', 'DELETE'], 'authenticated: read/insert/delete memo_participants');
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT'], 'authenticated: read profiles (updates column by column)');
select results_eq(
  $$ select c.column_name::text collate "default" from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'profiles'
       and has_column_privilege('authenticated', 'public.profiles', c.column_name, 'UPDATE')
     order by 1 $$,
  array['asana_user_gid', 'full_name', 'is_admin'],
  'authenticated may update only full_name, is_admin, asana_user_gid (never onboarded_at, id, email)'
);
select table_privs_are('public', 'team_members', 'authenticated', array['SELECT', 'INSERT', 'DELETE'], 'authenticated: read/insert/delete team_members');
select table_privs_are('public', 'memos', 'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated: CRUD on memos');
select table_privs_are('public', 'memo_answers', 'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated: CRUD on memo_answers');
select table_privs_are('private', 'allowed_email_domains', 'authenticated', array[]::text[], 'authenticated: nothing on allowed_email_domains');
select table_privs_are('private', 'bootstrap_admins', 'authenticated', array[]::text[], 'authenticated: nothing on bootstrap_admins');
select table_privs_are('private', 'allowed_email_domains', 'anon', array[]::text[], 'anon: nothing on allowed_email_domains');
select is_empty(
  $$ select t from unnest(array['public.profiles', 'public.team_members', 'public.memos', 'public.memo_answers',
                                'public.invitations', 'public.memo_participants', 'public.memo_calls', 'public.calendar_links']) t
     where not has_table_privilege('service_role', t, 'SELECT, INSERT, UPDATE, DELETE') $$,
  'service_role keeps full access to the app tables'
);

-- ---------- schemas and functions ----------
select schema_privs_are('private', 'anon', array[]::text[], 'anon cannot use schema private');
select schema_privs_are('private', 'authenticated', array['USAGE'], 'authenticated may only use schema private');
select results_eq(
  $$ select p.proname::text collate "default" from pg_proc p
     where p.pronamespace = 'private'::regnamespace and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by 1 $$,
  array['can_answer', 'can_manage_call', 'can_read_memo', 'is_admin', 'is_team_member', 'my_call_memos', 'my_teams'],
  'authenticated may execute the RLS helpers and nothing else in private'
);
select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace = 'private'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon (and PUBLIC) may execute nothing in private'
);
select results_eq(
  $$ select p.proname::text collate "default" from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1 $$,
  array['can_sign_in', 'complete_onboarding', 'create_call_memo'],
  'public has exactly the three API functions'
);
select results_eq(
  $$ select p.proname::text collate "default" from pg_proc p
     where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1 $$,
  array['can_sign_in'],
  'anon may only call can_sign_in()'
);
select is_definer('public', 'can_sign_in', array['text'], 'can_sign_in() is security definer (reads private lists)');
select isnt_definer('public', 'create_call_memo',
  array['team_key', 'memo_lang', 'text', 'jsonb', 'timestamp with time zone', 'text', 'text[]'],
  'create_call_memo() runs as the caller (RLS applies)');
select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every public function pins search_path to empty'
);
select is_definer('private', 'is_admin', array[]::name[], 'is_admin() is security definer');
select is_definer('private', 'is_team_member', array['team_key'], 'is_team_member() is security definer');
select is_definer('private', 'can_read_memo', array['uuid'], 'can_read_memo() is security definer');
select is_definer('private', 'can_answer', array['uuid'], 'can_answer() is security definer');
select volatility_is('private', 'is_admin', array[]::name[], 'stable', 'is_admin() is stable');
select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every private function pins search_path to empty'
);

-- ---------- triggers ----------
select triggers_are('public', 'memos', array['memos_guard', 'memos_search_text'], 'memos triggers');
select triggers_are('public', 'memo_answers', array['memo_answers_guard'], 'memo_answers trigger');
select triggers_are('public', 'profiles', array['profiles_guard'], 'profiles trigger');
select trigger_is('auth', 'users', 'on_auth_user_check_email_domain', 'private', 'check_auth_user_email_domain', 'auth.users: domain check before insert');
select trigger_is('auth', 'users', 'on_auth_user_check_email_domain_update', 'private', 'check_auth_user_email_domain', 'auth.users: domain check before email change');
select trigger_is('auth', 'users', 'on_auth_user_created', 'private', 'handle_new_auth_user', 'auth.users: profile created after insert');
select trigger_is('auth', 'users', 'on_auth_user_email_updated', 'private', 'handle_auth_user_email_change', 'auth.users: email change synced to the profile');
select ok(
  (select tgtype & 2 = 2 from pg_trigger where tgname = 'on_auth_user_check_email_domain' and tgrelid = 'auth.users'::regclass),
  'the domain check runs BEFORE insert'
);

select * from finish();
rollback;
