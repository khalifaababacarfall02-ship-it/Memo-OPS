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
src/lib/auth/*                Email checks, sign-in error messages, current viewer, safe redirects
src/lib/google/*              Google Calendar: OAuth, encrypted tokens, Calendar API (server only)
src/lib/i18n.ts               UI language from the `bxh-lang` cookie (server)
src/lib/database.types.ts     Types for supabase-js (kept in sync with the migrations)
src/components/shell/*        Frame (sidebar or top bar, page header), team pills, language switch, account, guide, toast, modal
src/components/memo/*         Editor (sheet, rail panels), export sheet
src/components/list/*         List view pieces
src/components/asana/*        "Send to Asana" (phase 2)
src/app/…                     Routes (see §4)
supabase/migrations/*.sql     Schema, RLS, triggers
supabase/tests/*.sql          pgTAP tests (RLS + workflow), `npm run db:test`
supabase/seed.sql             Allowed domains / bootstrap admins (edit before first deploy)
supabase/config.toml          Local Supabase config
supabase/templates/*.html     Supabase Auth's emails (the app sends none; kept for links asked straight from the Auth API)
scripts/db-test.sh            Runs migration + seed + pgTAP on a throwaway Postgres (no Docker)
tests/unit, src/**/*.test.ts  Vitest unit tests
e2e/*.spec.ts                 Playwright end-to-end tests (run against a local Supabase)
```

## 2. Data model

Enums: `team_key` = `ops | growth | crea | sav | finance | mini` (the six pills; `mini`
is the ad mini memo), `memo_lang` = `fr | en`, `memo_status` = `draft | to_decide | decided | archived`.

| table | columns |
|---|---|
| `profiles` | `id` (= auth.users.id), `email`, `full_name`, `is_admin`, `asana_user_gid`, `created_at`, `updated_at`, `onboarded_at` (set at the first sign-in, `/welcome`) |
| `team_members` | `user_id` → profiles, `team`, `created_at`; PK (user_id, team) |
| `memos` | `id`, `team`, `lang`, `title`, `author_id` → profiles, `decider_id` → profiles, `status`, `content jsonb`, `asana_task_gid`, `search_text`, `decided_at`, `created_at`, `updated_at` |
| `memo_answers` | `memo_id` → memos (cascade), `question_id` (id of a question in `content.qs`), `answer`, `answered_by` → profiles, `created_at`, `updated_at`; PK (memo_id, question_id) |
| `invitations` | `email` (PK, lower case), `team` (starting pôle, null = they choose), `invited_by` → profiles, `created_at` — who may sign in, managed by admins on `/team` |
| `memo_participants` | `memo_id` → memos (cascade), `email`, `added_by`, `created_at`; PK (memo_id, email) — the people of the memo's call (by email: they may not have signed in yet) |
| `memo_calls` | `memo_id` (PK) → memos (cascade), `starts_at`, `event_id` (calendar event: iCal UID, `\|<original start>` for one occurrence of a repeating event), `updated_at` — kept out of `memos` so it never bumps `memos.updated_at` |
| `calendar_links` | `user_id` (PK) → profiles (cascade), `url` (https, the person's secret iCal address), `updated_at` |
| `google_connections` | `user_id` (PK) → profiles (cascade), `google_email`, `refresh_token` (AES-256-GCM with the server's `GOOGLE_TOKEN_KEY`: `v1.<iv>.<tag>.<ciphertext>`), `scope`, `connected_at`, `updated_at` — owner only (admins included cannot read it) |
| `private.access_codes` | `email` (PK), `code_hash` (bcrypt), `expires_at` (7 days), `attempts` (locked at 5), `created_by` — one pending access code per address; not reachable through the API |
| `private.allowed_email_domains` | `domain` — who may sign up (not exposed through the API) |
| `private.allowed_emails` | `email` — single addresses allowed to sign up outside those domains |
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
`private.can_answer(uuid)`, `private.my_teams()` and `private.my_call_memos()` (used by the memos
read policy, evaluated once per statement), `private.can_manage_call(uuid)`. Policies call
`(select auth.uid())` / `(select private.is_admin())`.

- **profiles**: every signed-in user reads all profiles (to pick a decision maker).
  A user updates their own `full_name`; only admins change `is_admin`; `id`/`email` are immutable
  (guard trigger). No insert/delete through the API (created by the auth trigger, cascade on user delete).
- **team_members**: everyone signed in reads; only admins insert/delete.
- **memos**: read if admin, OR member of the memo's team, OR author, OR decision maker, OR one of
  the people of its call (`memo_participants.email` = the caller's profile email).
  Insert: `author_id = auth.uid()`, `status = 'draft'`, and the memo's team is one of the author's
  teams (admins: any team) — a decision maker may be anyone. Update: author, decision maker or admin
  (column/transition rules in the guard trigger below). Delete: author while `draft`, or admin.
- **invitations**: admins only (read, add, remove).
- **memo_participants**, **memo_calls**: read with the memo (`can_read_memo`); added, changed and
  removed by the author (or an admin) while the memo is `draft` or `to_decide` (`can_manage_call`).
  At most 50 people per call (trigger).
- **calendar_links**: the owner only — admins cannot read anyone's link.
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

BoxHero uses personal addresses (Gmail, Proton): admins invite each person on `/team`
(`public.invitations`, optionally with a starting pôle). `auth.users` BEFORE INSERT trigger rejects
emails that are not invited, not listed in `private.allowed_emails` and whose domain is not in
`private.allowed_email_domains` (fail closed: all empty = nobody can sign up).
AFTER INSERT creates the `profiles` row (`full_name` from metadata or the email's local part,
`is_admin` from `private.bootstrap_admins`) and the membership of the invitation's pôle.
`public.can_sign_in(email)` (yes for an invited / allowed address or an existing account) is no
longer callable through the API: access codes are only given to invited addresses.

**First sign-in.** Until `profiles.onboarded_at` is set, `requireViewer()` sends the person to
`/welcome`: their name, and their pôle when nobody gave them one (admins may skip it), saved by
`public.complete_onboarding(name, team)` (security definer: the only way a non-admin joins a team,
and only once — `onboarded_at` is not writable through the API: signed-in users may update only
`full_name`, `is_admin`, `asana_user_gid` of `profiles`, column by column). Removing an invitation
also removes the address from `private.allowed_emails` (trigger). Then they land on `/?team=<their pôle>` (or where they were going).

## 3. Auth flow

Address + password (Supabase Auth), `@supabase/ssr` cookies. The app sends no email.

1. **Access codes.** An admin invites an address on `/team`, which calls
   `public.issue_access_code(email)` (admins only; the address must be invited, on an allowed
   domain, or already have an account): 8 characters without look-alikes, shown once as
   `XXXX-XXXX` in a ready-to-send message with the link `/login?setup=1&email=…`; only a bcrypt
   hash is stored, valid 7 days, locked after 5 wrong tries. *Nouveau code* (pending invitations,
   and each person on `/team`) issues another one — a forgotten password is the same path.
2. **Choosing the password** (`/login`, "Première connexion ou mot de passe oublié ?"): server
   action `setPasswordWithCode` checks the form (8 characters minimum, 72 bytes maximum — bcrypt's
   limit — and the confirmation), then calls `public.set_password_with_code(email, code, password)`
   (callable without a session; returns `ok | invalid | expired | locked | weak`, never raises, so a
   wrong try is counted). It creates the Supabase Auth user the way GoTrue does (confirmed, bcrypt
   cost 10, an `email` identity) — the `auth.users` triggers still apply: invited address, profile
   created — or changes the existing user's password, and burns the code. Then it signs in.
3. **Signing in**: server action `signIn` → `signInWithPassword`, then `redirect(next)` (same-origin
   paths only). A wrong address and a wrong password get the same message.
4. `src/proxy.ts` refreshes the session on every request. Signed-out: GET pages → 307
   `/login?next=…`; other methods (Server Actions) → 401 text/plain; `/api/*` → 401 JSON, except
   `/api/google/connect` and `/api/google/callback` (opened in the browser) → `/login`.
5. `/login?error=profile` = session without a profile row (show `ui.profileMissing` and a sign-out
   button). `/login?error=…` is never bounced (no loops). `/auth/confirm` still verifies an email
   link someone asked for straight from the Auth API (`?error=auth` when it is expired or used).
   If Supabase Auth is unreachable, the proxy does not treat people as signed out: pages go on (their
   own viewer check shows the error page) and `/api/*` answers 503 `{ error: "unavailable" }`.
6. `/auth/signout` (POST) signs out this browser only.

Sign-in and password changes happen on the server (Server Actions), so Supabase Auth's per-IP
rate limits count the app's server, not each person: fine for a team, and a reason to keep them.

`getViewer()` (`src/lib/auth/viewer.ts`, request-cached) returns
`{ id, email, fullName, isAdmin, teams, onboarded }` or `null`; `requireViewer()` redirects to
`/login`, and to `/welcome` until the first sign-in is done.

## 4. Routes

| route | what |
|---|---|
| `/` | List view. On top, "Mes prochains appels" (calendar + memos of calls the viewer is in, in a `<Suspense>`), then the list; the sidebar's team pills (+ "All") filter it, status tabs, search, memo rows. Rail: new memo, "waiting for my decision", my memos. Params: `team`, `status` (`all` = everything but archived, default), `q`, `limit` (200 per step, "Show more"). |
| `/memos/new?team=…[&example=1]` | Blank (or example) memo in the editor. Nothing is stored until the first edit; then the row is inserted and the editor moves to `/memos/<id>` (`router.replace`, handing over its save session so nothing typed meanwhile is lost). A non-member is sent to their first team; someone with no team sees `ui.noTeam`. |
| `/memos/[id]` | Editor / reader for one memo (permissions from the workflow rules). |
| `/team` | Admins: invite people (and get their access code), *Nouveau code*, assign teams and admin rights. Everyone: edit their display name. |
| `/welcome` | First sign-in: name and pôle. |
| `/login`, `/auth/confirm`, `/auth/signout` | Auth (`/login?setup=1&email=…` opens "choose my password"). |
| `/api/google/connect`, `/api/google/callback` | "Connecter Google Agenda" (see §The call). |
| `POST /api/asana` | Phase 2: create/update the Asana task (server-side token), see below. |
| `POST /api/slack` | DM the memo to the people of its call, see below. |

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

- The memo sheet keeps the prototype classes (`wrap`, `sheet`, `rail`, `panel`, `sec`, `ex`,
  `field`, `row`, `need`, `qrow`, `btn primary|acc|ghost`, `memos`, `toast`, `modal`, `#exp`…).
  Around it, `AppFrame` draws a sidebar (brand, Accueil / L'équipe, the pôles, language and
  account) on signed-in pages and a slim top bar on single-card pages; on screens ≤900px the
  sidebar becomes a top block with the pôles as a row of chips. `src/styles/shell.css` (loaded
  after the prototype's CSS) holds the lighter look: sentence-case page header, calm cards.
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
  and keep Tab inside.
- Single-card pages (login, 404, error) share `src/components/notfound/*` (styles via `SoloStyles`).
- Dark mode: the prototype's example boxes were unreadable in dark mode (light `--acc-soft` behind
  light text); `src/styles/shell.css` tints them from the team colour. Light mode is unchanged.

## 6. Security rules

- Browser code only ever sees `NEXT_PUBLIC_SUPABASE_URL` and the publishable key. All data
  access goes through RLS. No service-role key in the app.
- The Asana token (`ASANA_ACCESS_TOKEN`) is read only in server code (`import "server-only"`).
  `ASANA_API_BASE` (tests only) may point the client at a local mock: https, or http to localhost.
- Google: the client secret and `GOOGLE_TOKEN_KEY` stay on the server; refresh tokens are stored
  encrypted (AES-256-GCM) and readable only by their owner (RLS); the OAuth state is checked
  (httpOnly cookie, constant-time compare); the scope is read-only.
- Passwords are Supabase Auth's (bcrypt); access codes are stored as bcrypt hashes, used once,
  7 days, 5 tries.
- Security headers on every route (`next.config.ts`): `frame-ancestors 'none'` / `X-Frame-Options`
  (the decision buttons cannot be clickjacked), nosniff, referrer policy, HSTS, permissions policy.
- Redirect targets (`next`) are validated as same-origin paths.
- Search input is escaped before it reaches PostgREST filters.

### The call: people, Slack, calendar

- **People of the call** (rail panel "L'appel", `src/components/memo/CallPanel.tsx`): the author
  (or an admin) sets the date and adds people by name (a profile) or by address; written straight to
  `memo_calls` / `memo_participants` with the browser client (RLS), outside the editor's autosave.
- **`POST /api/slack`** `{ memoId }`: author, decision maker or admin. Sends a direct message from
  the Slack app to each person of the call and the decision maker (except the sender), found by email
  (`users.lookupByEmail`), with a button to the memo; the call time is a Slack date token, so each
  person reads it in their own time zone. Returns `{ sent, missing, failed }`; errors `{ error }`:
  `auth` 401, `badRequest` 400, `notAllowed` 403, `notFound` 404, `nobody` 422, `notConfigured` 503
  (no `SLACK_BOT_TOKEN`: the button stays and says so), `slackAuth` / `slack` 502. The token stays on
  the server. App manifest: `slack/manifest.json` (scopes `chat:write`, `users:read`,
  `users:read.email`). Code: `src/lib/slack/`.
- **Google Calendar** (`src/lib/google/`, `/api/google/*`): "Connecter Google Agenda" → `connect`
  sets a random state in an httpOnly cookie and sends the person to Google's consent screen
  (`openid email calendar.events.readonly`, offline access, their address as login hint) →
  `callback` checks the state, exchanges the code (client secret on the server), refuses a consent
  without the calendar box, and stores the refresh token encrypted (`google_connections`, as the
  person through RLS) → `/?google=connected|denied|scope|error|off` (a one-time notice). The home
  page then reads the primary calendar's next 14 days (Calendar API v3, `singleEvents`; access
  tokens cached in memory until they expire); Google refusing the token (revoked) shows "Reconnect".
  *Déconnecter* revokes the token at Google and deletes the row. Without `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` / `GOOGLE_TOKEN_KEY` the button is hidden. Tests only: `GOOGLE_AUTH_BASE`,
  `GOOGLE_TOKEN_BASE`, `GOOGLE_API_BASE` point to a local mock (`e2e/google.spec.ts`).
- **Other calendars** (`src/lib/calendar/`): each person can instead save their calendar's secret
  iCal address (a Proton Calendar share link, Outlook, iCloud, or Google's "Secret address in iCal
  format"); Google's connection wins when both exist. The server
  fetches it — only those providers' hosts, https, redirects checked, 8 s timeout, 8 MB cap, 2 min
  in-memory cache — and lists the next 14 days (ical.js: repeating events, moved / cancelled
  occurrences, the file's own VTIMEZONEs; a zone it names without defining — or a floating time,
read in the calendar's `X-WR-TIMEZONE` — goes through `Intl`, never the server's zone, and nothing
is registered globally; rooms and shared calendars are not people; all-day events left out). "Prepare the memo" calls
  `public.create_call_memo()` (security invoker: memo + call + people in one transaction, as the
  caller; the caller's memo for the same event is reopened instead). Tests only:
  `CALENDAR_TEST_HOSTS` allows a local mock.
