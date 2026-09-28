# BoxHero Memo — architecture

The prototype `boxhero-memo.html` (single file, localStorage) becomes a team app:
**Next.js 16 (App Router, TypeScript) on Vercel + Supabase (Postgres, Auth, RLS)**.
The design is kept exactly: `src/app/globals.css` is the prototype CSS, the
markup keeps the prototype's class names, and every text lives in
`content/boxhero.json`.

> Next.js 16 notes: `middleware.ts` is now `src/proxy.ts` (export `proxy`);
> `params`, `searchParams`, `cookies()` and `headers()` are async only;
> Turbopack is the default bundler. Docs ship in `node_modules/next/dist/docs/`.

## 1. Layout of the repo

```
content/boxhero.json          ALL copy, examples, guide, team colours, cover paths (FR + EN)
public/covers/<team>.jpg      Team cover images (hero + PDF cover), extracted from the prototype
src/app/globals.css           Prototype CSS, verbatim (only font variables adapted)
src/styles/<feature>.css      CSS for elements the prototype did not have (list, decision panel, login, team)
src/lib/content.ts            Typed accessors over content/boxhero.json (+ esc/md/fmt helpers)
src/lib/memo/model.ts         Memo document model, blank/example memos, normalisation, workflow rules
src/lib/memo/export.ts        Copy-for-Asana HTML, plain text, PDF sheet HTML, Asana API notes (pure)
src/lib/memo/pdf.ts           html2pdf download with print fallback (client only)
src/lib/memo/clipboard.ts     Rich clipboard copy with manual fallback (client only)
src/lib/supabase/client.ts    Browser client (publishable key, RLS)
src/lib/supabase/server.ts    Server client (per request, cookies)
src/lib/supabase/proxy.ts     Session refresh used by src/proxy.ts
src/lib/auth/*                Allowed email domains, current viewer, safe redirects
src/lib/i18n.ts               UI language from the `bxh-lang` cookie (server)
src/lib/database.types.ts     Types for supabase-js (kept in sync with the migrations)
src/components/shell/*        Hero, team pills, language switch, guide, toast, modal, footer, frame
src/components/memo/*         Editor (sheet, rail panels), export sheet
src/components/list/*         List view pieces
src/components/asana/*        "Send to Asana" (phase 2)
src/app/…                     Routes (see §4)
supabase/migrations/*.sql     Schema, RLS, triggers
supabase/tests/*.sql          pgTAP tests (RLS + workflow)
supabase/seed.sql             Allowed domains / bootstrap admins (edit before first deploy)
supabase/config.toml          Local Supabase config (auth redirect URLs, email template)
supabase/templates/*.html     Magic-link email
tests/unit, src/**/*.test.ts  Vitest unit tests
e2e/*.spec.ts                 Playwright end-to-end tests (run against a local Supabase)
```

## 2. Data model

Enums: `team_key` = `ops | growth | crea | sav | finance | mini` (the six pills; `mini`
is the ad mini memo), `memo_lang` = `fr | en`, `memo_status` = `draft | to_decide | decided | archived`.

| table | columns |
|---|---|
| `profiles` | `id` (= auth.users.id), `email`, `full_name`, `is_admin`, `asana_user_gid`, `created_at`, `updated_at` |
| `team_members` | `user_id` → profiles, `team`, `created_at`; PK (user_id, team) |
| `memos` | `id`, `team`, `lang`, `title`, `author_id` → profiles, `decider_id` → profiles, `status`, `content jsonb`, `asana_task_gid`, `search_text`, `decided_at`, `created_at`, `updated_at` |
| `memo_answers` | `memo_id` → memos (cascade), `question_id` (id of a question in `content.qs`), `answer`, `answered_by` → profiles, `created_at`, `updated_at`; PK (memo_id, question_id) |
| `private.allowed_email_domains` | `domain` — who may sign up (not exposed through the API) |
| `private.bootstrap_admins` | `email` — profiles created with these emails get `is_admin = true` (Mattéo, Khalifa) |

`memos.content` holds the document without the title (see `src/lib/memo/model.ts`):

```ts
// full memo (ops, growth, crea, sav, finance)
{ kind: "memo", author, meta: [to, from, date, subject], s: [why, what, how, now],
  acts: [{ id, action, owner, due }], needs: [{ id, done, text }], res, qs: [{ id, q }] }
// ad mini memo (mini)
{ kind: "mini", author, meta: [from, date, product, format], s: [what, why, how, now], works }
```

Answers are **not** in `content`: the decision maker writes them into `memo_answers`,
one row per question id, so the author can never overwrite them.

`search_text` is maintained by a trigger: lower-cased, accent-stripped title + every
string value of `content`. The list searches it with `ilike '%…%'` (trigram index).

### Who sees what (RLS)

Helper functions live in schema `private` (not exposed by the API), are
`security definer`, `stable`, with `set search_path = ''`:
`private.is_admin()`, `private.is_team_member(team_key)`, `private.can_read_memo(uuid)`,
`private.can_answer(uuid)`. Policies call `(select auth.uid())` / `(select private.is_admin())`.

- **profiles**: every signed-in user reads all profiles (to pick a decision maker).
  A user updates their own `full_name`; only admins change `is_admin`; `id`/`email` are immutable
  (guard trigger). No insert/delete through the API (created by the auth trigger, cascade on user delete).
- **team_members**: everyone signed in reads; only admins insert/delete.
- **memos**: read if admin, OR member of the memo's team, OR author, OR decision maker.
  Insert: `author_id = auth.uid()` and `status = 'draft'`. Update: author, decision maker or admin
  (column/transition rules in the guard trigger below). Delete: author while `draft`, or admin.
- **memo_answers**: read if the memo is readable. Insert/update/delete only through
  `private.can_answer(memo_id)`: caller is the memo's decision maker (or an admin) and the memo is
  `to_decide`; `answered_by` must be `auth.uid()`.

### Workflow guard (`memos_guard` trigger, BEFORE UPDATE)

Mirrors `canTransition` / `canEditContent` in `src/lib/memo/model.ts`:

| transition | from → to | who |
|---|---|---|
| submit | draft → to_decide (needs `decider_id` and a non-empty title) | author |
| withdraw | to_decide → draft | author |
| decide | to_decide → decided (sets `decided_at`) | decision maker |
| reopen | decided → to_decide (clears `decided_at`) | decision maker |
| archive | draft/to_decide/decided → archived | author or decision maker |
| restore | archived → draft | author |

Admins may do any transition. `id`, `team`, `author_id`, `created_at` never change.
`title`, `content`, `lang`, `decider_id` change only by the author (or an admin) while the memo is
`draft` or `to_decide`. `updated_at` is set by the trigger. Service-role calls (no `auth.uid()`)
bypass the guard.

### Sign-up restriction

`auth.users` BEFORE INSERT trigger rejects emails whose domain is not in
`private.allowed_email_domains` (fail closed: empty table = nobody can sign up).
AFTER INSERT creates the `profiles` row (`full_name` from metadata or the email's local part,
`is_admin` from `private.bootstrap_admins`). The app also checks `ALLOWED_EMAIL_DOMAINS`
before calling Supabase, to show a friendly message.

## 3. Auth flow

Email magic link (passwordless), `@supabase/ssr` cookies.

1. `/login` → server action `sendMagicLink` validates the email + domain, then
   `signInWithOtp({ email, options: { emailRedirectTo: <site>/auth/confirm?next=<path> } })`.
2. The email links to `/auth/confirm`. The route accepts both
   `?token_hash=…&type=…` (custom template, works in any browser) and `?code=…` (PKCE default
   template), creates the session cookie and redirects to `next` (same-origin paths only).
3. `src/proxy.ts` refreshes the session on every request and redirects signed-out visitors to
   `/login?next=…` (API routes get 401).
4. `/auth/signout` (POST) clears the session.

`getViewer()` (`src/lib/auth/viewer.ts`, request-cached) returns
`{ id, email, fullName, isAdmin, teams }` or `null`; `requireViewer()` redirects to `/login`.

## 4. Routes

| route | what |
|---|---|
| `/` | List view. Hero with team pills (+ "All") as filter, status tabs, search, memo rows. Rail: new memo, "waiting for my decision", my memos. Params: `team`, `status` (`all` = everything but archived, default), `q`. |
| `/memos/new?team=…[&example=1]` | Blank (or example) memo in the editor. Nothing is stored until the first edit; then the row is inserted and the URL becomes `/memos/<id>` (history.replaceState). |
| `/memos/[id]` | Editor / reader for one memo (permissions from the workflow rules). |
| `/team` | Admins: assign teams and admin rights. Everyone: edit their display name. |
| `/login`, `/auth/confirm`, `/auth/signout` | Auth. |
| `POST /api/asana` | Phase 2: create/update the Asana task (server-side token). |

## 5. UI conventions

- Markup keeps the prototype classes (`hero`, `wrap`, `sheet`, `rail`, `panel`, `sec`, `ex`,
  `field`, `row`, `need`, `qrow`, `btn primary|acc|ghost`, `memos`, `toast`, `modal`, `#exp`…).
- Team colours: `teamStyle(team)` on the page wrapper **and** on `document.documentElement`
  (so portals such as the PDF sheet and the toast use them too).
- UI language: cookie `bxh-lang` (`fr` default). The FR/EN switch sets it and refreshes.
  The sheet's labels and examples follow the UI language. Exports (copy, PDF, Asana) use the
  memo's `lang`, which is set from the UI language when the author creates or edits the memo.
- Texts only from `content/boxhero.json` via `src/lib/content.ts`. `{token}` placeholders via `fmt()`.
- New visual elements reuse the tokens (`--paper`, `--soft`, `--line`, `--muted`, `--acc`,
  `--acc-soft`, `--r-*`, `--ui`, `--text`) and live in `src/styles/*.css`.
- Everything works in light and dark mode (the prototype's `prefers-color-scheme` tokens).
- The PDF sheet (`#exp`) is rendered through a portal as a direct child of `<body>` (print CSS
  relies on `body>*:not(#exp)`).

## 6. Security rules

- Browser code only ever sees `NEXT_PUBLIC_SUPABASE_URL` and the publishable key. All data
  access goes through RLS. No service-role key in the app.
- The Asana token (`ASANA_ACCESS_TOKEN`) is read only in server code (`import "server-only"`).
- Redirect targets (`next`) are validated as same-origin paths.
- Search input is escaped before it reaches PostgREST filters.
