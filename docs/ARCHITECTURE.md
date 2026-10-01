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
supabase/tests/*.sql          pgTAP tests (RLS + workflow), `npm run db:test`
supabase/seed.sql             Allowed domains / bootstrap admins (edit before first deploy)
supabase/config.toml          Local Supabase config (auth redirect URLs, email templates)
supabase/templates/*.html     magic_link.html + confirmation.html (a first sign-in uses "confirmation")
scripts/db-test.sh            Runs migration + seed + pgTAP on a throwaway Postgres (no Docker)
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
`private.can_answer(uuid)`, `private.my_teams()` (used by the memos read policy, evaluated once
per statement). Policies call `(select auth.uid())` / `(select private.is_admin())`.

- **profiles**: every signed-in user reads all profiles (to pick a decision maker).
  A user updates their own `full_name`; only admins change `is_admin`; `id`/`email` are immutable
  (guard trigger). No insert/delete through the API (created by the auth trigger, cascade on user delete).
- **team_members**: everyone signed in reads; only admins insert/delete.
- **memos**: read if admin, OR member of the memo's team, OR author, OR decision maker.
  Insert: `author_id = auth.uid()`, `status = 'draft'`, and the memo's team is one of the author's
  teams (admins: any team) — a decision maker may be anyone. Update: author, decision maker or admin
  (column/transition rules in the guard trigger below). Delete: author while `draft`, or admin.
- **memo_answers**: read if the memo is readable. Insert/update/delete only through
  `private.can_answer(memo_id)`: caller is the memo's decision maker (or an admin) and the memo is
  `to_decide`; `answered_by` must be `auth.uid()`.

### Workflow guard (`memos_guard` trigger, BEFORE INSERT OR UPDATE)

Mirrors `canTransition` / `canEditContent` in `src/lib/memo/model.ts`:

| transition | from → to | who |
|---|---|---|
| submit | draft → to_decide (needs `decider_id` and a non-empty title) | author |
| withdraw | to_decide → draft | author |
| decide | to_decide → decided (sets `decided_at`) | decision maker |
| reopen | decided → to_decide (clears `decided_at`) | decision maker |
| archive | draft/to_decide/decided → archived | author or decision maker |
| restore | archived → draft | author |

On insert the trigger forces `author_id = auth.uid()`, `status = 'draft'`, and clears `decided_at`
and `asana_task_gid`. The "needs a decision maker and a title" rule also applies when the title or
decider change while `to_decide`. Admins may do any transition. `id`, `team`, `author_id`,
`created_at` never change.
`title`, `content`, `lang`, `decider_id` change only by the author (or an admin) while the memo is
`draft` or `to_decide`. `updated_at` is set by the trigger. Service-role calls (no `auth.uid()`)
bypass the guard.

Other rules enforced in SQL: an answer's `question_id` must exist in `content.qs`; the last admin
cannot lose admin rights; `profiles.email` mirrors `auth.users.email`; deleting a user who authored
memos or answers is refused (offboard by removing teams/admin and banning); deleting a decision maker
sets `decider_id = null` on their memos and sends any memo that was `to_decide` back to `draft`
(migration `20261001090000`).

**What the app must know.** RLS hides rows silently: an UPDATE/DELETE the caller may not make
affects 0 rows without error, so always `.select()` after update/delete and treat an empty result
as "not allowed". Someone who is not the author (decision maker changing status, Asana route) must
send ONLY the columns they change: resending `title`/`content`/`lang`/`decider_id` raises
"only the author can edit this memo". `memos.lang` has no default (always send it). Answers:
`.upsert({ memo_id, question_id, answer }, { onConflict: "memo_id,question_id" })`; show only
answers whose `question_id` is still in `content.qs`. Trigger errors reach the client as
`{ code, message }` (42501 → HTTP 403, 23514 → 400, 23503 → 409); messages are listed at the top
of the migration (e.g. `memo status change not allowed: draft -> decided`,
`a memo to decide needs a decision maker and a title`).

**Search.** `search_text` = lower(unaccent(title + every string value of `content` except `id` and
`kind`)). Normalise the query the same way before `ilike '%q%'`: NFD, strip combining marks,
œ→oe, æ→ae, ß→ss, lowercase; escape `%`, `_`, `\` and PostgREST's reserved characters.
The JS mirror is `src/lib/search.ts` (checked against Postgres' unaccent on every character of the
copy); the value goes only through `.ilike()`. A typed `*` becomes `_` because PostgREST reads `*` as
`%` in ilike values and has no escape for it. The list's default status filter (`all`) excludes archived memos.

### Sign-up restriction

`auth.users` BEFORE INSERT trigger rejects emails whose domain is not in
`private.allowed_email_domains` (fail closed: empty table = nobody can sign up).
AFTER INSERT creates the `profiles` row (`full_name` from metadata or the email's local part,
`is_admin` from `private.bootstrap_admins`). The app also checks `ALLOWED_EMAIL_DOMAINS`
before calling Supabase, to show a friendly message.

## 3. Auth flow

Email magic link (passwordless), `@supabase/ssr` cookies.

1. `/login` → server action `sendMagicLink` validates the email + domain, stores the wanted path
   in the httpOnly cookie `bxh-next` (1 h), then
   `signInWithOtp({ email, options: { emailRedirectTo: <request origin>/auth/confirm } })`.
   `emailRedirectTo` has **no query string**: the email templates build
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`, and a query in RedirectTo would
   swallow the token (verified against GoTrue).
2. `/auth/confirm` verifies `token_hash` with `verifyOtp({ type: "email", token_hash })` — works in
   any browser, for new users (confirmation template) and existing ones (magic_link template),
   including PKCE `pkce_…` hashes. It also accepts `?code=` (default template; same browser only).
   It redirects to `?next` or the `bxh-next` cookie (same-origin paths only), else `/`.
3. `src/proxy.ts` refreshes the session on every request. Signed-out: GET pages → 307
   `/login?next=…`; other methods (Server Actions) → 401 text/plain; `/api/*` → 401 JSON. A stray
   link that lands elsewhere with `?token_hash` (Supabase fell back to the Site URL because the
   origin was not in the redirect allow list) is forwarded to `/auth/confirm`.
4. `/login?error=auth` = link expired/used (show `ui.authError`), `/login?error=profile` = session
   without a profile row (show `ui.profileMissing` and a sign-out button). `/login?error=…` is never
   bounced (no loops).
   If Supabase Auth is unreachable, the proxy does not treat people as signed out: pages go on (their
   own viewer check shows the error page) and `/api/*` answers 503 `{ error: "unavailable" }`.
5. `/auth/signout` (POST) signs out this browser only.

Supabase Auth hides the trigger's message when it rejects a domain: `signInWithOtp` returns a 500
"Database error saving new user". The app checks `ALLOWED_EMAIL_DOMAINS` first and maps that 500
to `badDomain`. Keep the env var and `private.allowed_email_domains` in sync.

`getViewer()` (`src/lib/auth/viewer.ts`, request-cached) returns
`{ id, email, fullName, isAdmin, teams }` or `null`; `requireViewer()` redirects to `/login`.

## 4. Routes

| route | what |
|---|---|
| `/` | List view. Hero with team pills (+ "All") as filter, status tabs, search, memo rows. Rail: new memo, "waiting for my decision", my memos. Params: `team`, `status` (`all` = everything but archived, default), `q`, `limit` (200 per step, "Show more"). |
| `/memos/new?team=…[&example=1]` | Blank (or example) memo in the editor. Nothing is stored until the first edit; then the row is inserted and the editor moves to `/memos/<id>` (`router.replace`, handing over its save session so nothing typed meanwhile is lost). A non-member is sent to their first team; someone with no team sees `ui.noTeam`. |
| `/memos/[id]` | Editor / reader for one memo (permissions from the workflow rules). |
| `/team` | Admins: assign teams and admin rights. Everyone: edit their display name. |
| `/login`, `/auth/confirm`, `/auth/signout` | Auth. |
| `POST /api/asana` | Phase 2: create/update the Asana task (server-side token), see below. |

### How the editor saves (`src/lib/memo/editor/`)

- Autosave ~600 ms after typing, flushed before status changes, sends and page hide.
- Optimistic concurrency: updates match `updated_at` as last loaded. On a mismatch the stored row is
  read back and merged field by field with the local changes (`merge.ts`); if both changed the same
  field, the local text wins and `ui.editedElsewhere` is shown once. A tab that becomes visible with
  nothing pending refreshes.
- Errors are classified (`errors.ts`): only network/5xx failures are retried; locks, too-long values,
  missing decision maker, expired session and permission errors get their own message and are not
  retried with the same payload.
- Unsaved text is kept per user and memo in localStorage (`drafts.ts`) and restored after a reload or
  a new sign-in; a memo that became locked drops local edits.
- Answers are saved one question at a time; an answer to a question the author removed is dropped
  with `ui.answerDropped`.

### `POST /api/asana` (phase 2)

Body `{ "memoId": "<uuid>" }` (JSON only). Callers: the memo's author, decision maker, or an
admin; the memo is loaded through RLS. Creates a task in `ASANA_PROJECT_GID` named
`asanaTaskName()` with `asanaTaskNotes()` (+ a link back to the memo), assigned to the decision
maker (`profiles.asana_user_gid`, else their email; retried unassigned if Asana refuses). If the memo
already has `asana_task_gid`, that task is updated only when it belongs to the Memos project
(anyone who can edit the memo could write any gid there — protecting the column itself would need a
service-role key, which the app never uses); otherwise a new task is created. The new gid is saved
with a compare-and-set on the value read before; if another send won the race, this request deletes
the task it just created and returns the winner's.
Returns `{ gid, url, assigned, updated }`; errors `{ error }`: `badRequest` 400, `unauthorized` 401,
`forbidden` 403, `notFound` / `notConfigured` 404, `needDecider` 409, `saveError` / `serverError` 500,
`asanaError` 502. Code: `src/lib/asana/{client,sync,send}.ts`.

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
- The PDF sheet (`#exp`) is rendered by `<ExportSheet>` through a portal as a direct child of
  `<body>` (print CSS relies on `body>*:not(#exp)`). The editor gets it with `getExportSheet()` and
  calls `downloadPdf(el, pdfFileName(memo))`. `pdf.ts` deliberately differs from the prototype on
  two points (renders an in-flow copy; page-break avoidance limited to the memo body) because the
  prototype's own html2pdf call produced a blank page.
- Copy for Asana: `const h = asanaHTML(m); copyRich(h, htmlToText(h))` → toast `ui.copied`, or the
  manual-copy modal on `"manual"`. Output is byte-identical to the prototype (golden tests).
- Fonts: Schibsted Grotesk through `next/font/google`; Newsreader self-hosted in `src/app/fonts/`
  exactly as the prototype loaded it (weights 400–500 + italic 400, optical sizes), so bold in the
  examples is the browser's bold of 500 and lines wrap as in the design.
- Modals (`src/components/shell/Modal.tsx`) render in `<body>` like the prototype's `#gmodal`/`#modal`
  and keep Tab inside. On phones (≤600px) the account pill leaves the hero and sits above the footer,
  so the hero keeps the prototype's brand row.
- Single-card pages (login, 404, error) share `src/components/notfound/*` (styles via `SoloStyles`).
- Dark mode: the prototype's example boxes were unreadable in dark mode (light `--acc-soft` behind
  light text); `src/styles/shell.css` tints them from the team colour. Light mode is unchanged.

## 6. Security rules

- Browser code only ever sees `NEXT_PUBLIC_SUPABASE_URL` and the publishable key. All data
  access goes through RLS. No service-role key in the app.
- The Asana token (`ASANA_ACCESS_TOKEN`) is read only in server code (`import "server-only"`).
  `ASANA_API_BASE` (tests only) may point the client at a local mock: https, or http to localhost.
- Security headers on every route (`next.config.ts`): `frame-ancestors 'none'` / `X-Frame-Options`
  (the decision buttons cannot be clickjacked), nosniff, referrer policy, HSTS, permissions policy.
- Redirect targets (`next`) are validated as same-origin paths.
- Search input is escaped before it reaches PostgREST filters.
