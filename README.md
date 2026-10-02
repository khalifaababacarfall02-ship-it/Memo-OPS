# Mémo BoxHero

*Pas de mémo, pas de réunion.* The BoxHero decision memo app: write a memo
(Why, What, How, Now, Questions — or the ad mini memo), send it to the person
who decides, and get their answers in the app.

Next.js 16 (App Router, TypeScript) on **Vercel** · **Supabase** (Postgres,
Auth with address + password for invited people only, Row Level Security). Memos
are for calls: the people of the call read the memo before it, get it on **Slack**,
and everyone sees their next calls from their **calendar** on the home page
(Google Calendar in one click, or Proton/Outlook by link). The memo sheet and its
exports are the original prototype's; the app around it is lighter (a sidebar,
calm cards). How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's where

| | |
|---|---|
| `content/boxhero.json` | **Every text** (FR + EN), the examples, the guide, team colours and cover images. Edit it to change copy — no component changes needed. |
| `public/covers/` | Team cover images (PDF cover). |
| `src/app/` | Pages: `/` next calls + list, `/memos/new`, `/memos/[id]`, `/team`, `/welcome` (first sign-in), `/login`. |
| `slack/manifest.json` | The Slack app to install (sends memos by direct message). |
| `supabase/migrations/` | Database schema, RLS policies, workflow rules. |
| `supabase/templates/` | Supabase Auth's emails (unused by the app, which sends none; kept for links requested straight from the Auth API). |

Statuses: **Brouillon / Draft → À décider / To decide → Décidé / Decided**, and
**Archivé / Archived**. The author writes and sends for decision; the decision
maker answers each question in the app and marks it decided.

Who sees what (enforced by the database): everyone sees their teams' memos plus
the ones they wrote, must decide, or whose call they are in; admins (Mattéo,
Khalifa) see everything, invite people and manage teams on `/team`.

The first sign-in asks the person's name and pôle (unless the invitation gave
one), then opens that pôle's memos.

## Run it locally

Requirements: Node 20.9+ and the [Supabase CLI](https://supabase.com/docs/guides/local-development) with Docker.

```bash
npm install
npx supabase start                # local Postgres + Auth + Mailpit, applies migrations + seed
cp .env.example .env.local        # then paste the URL and publishable/anon key printed by `supabase start`
npm run dev                       # http://localhost:3000
```

Sign in: on `/login`, *Première connexion ou mot de passe oublié ?*, address
`khalifa@boxhero.test` (or `matteo@boxhero.test`, both admins), access code
`LOCAL-DEV` (from the local seed), then choose a password. The first sign-in asks
for a name and a pôle. Other people: invite them on `/team`, which gives their code.

## Tests

```bash
npm run lint && npm run typecheck
npm test                          # unit tests (Vitest), incl. golden tests against the prototype's exports
npm run db:test                   # migrations + RLS + workflow rules (pgTAP) on a throwaway Postgres, no Docker
npm run e2e                       # Playwright, against a running app + local Supabase (see playwright.config.ts)
```

`npm run db:test` needs Postgres 15+ binaries and pgTAP (Ubuntu:
`postgresql-16-pgtap`). CI (`.github/workflows/ci.yml`) runs lint, types, unit
tests, build and the database tests on every pull request.

## Deploy (first time)

### 1. Supabase

1. Create a project (EU region).
2. Apply the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
3. **Before anyone signs in**, in *SQL Editor*, invite the first admin, make
   them admin and give them a first access code (lower-case address; the code is
   8 letters or digits you pick, valid 7 days, used once). Everyone else is then
   invited from `/team` in the app, which gives their code.
   ```sql
   insert into public.invitations (email) values ('<khalifa-email>') on conflict do nothing;
   insert into private.bootstrap_admins (email) values ('<khalifa-email>') on conflict do nothing;
   insert into private.access_codes (email, code_hash, expires_at)
   values ('<khalifa-email>', extensions.crypt('<CODE1234>', extensions.gen_salt('bf', 8)), now() + interval '7 days')
   on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0;
   ```
   Then on the app: *Première connexion ou mot de passe oublié ?*, the address, the code, a password.
4. *Authentication → URL Configuration*: Site URL `https://<production-domain>`.
   No email is sent by the app: no SMTP or template to set up.

### 2. Vercel

1. *Add New → Project*, import this GitHub repository (framework: Next.js).
   Production branch `main`; every pull request gets a preview deployment.
2. *Settings → Environment Variables* (Production and Preview):

   | variable | value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase *Project Settings → API* URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
   | `NEXT_PUBLIC_SITE_URL` | production URL (needed for Google Calendar) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` | optional: Google Calendar in one click (see below) |
   | `SLACK_BOT_TOKEN` | optional: the Slack app's bot token (see below) |
   | `ASANA_ACCESS_TOKEN`, `ASANA_PROJECT_GID` | phase 2, optional (see below) |

   No secret is exposed to the browser: the publishable key is public by design
   and the data is protected by RLS. Never add the service-role key.
3. Deploy, then sign in with your address and the access code of step 1.3.

### Day to day

- **Add someone**: an admin invites their email (Gmail, Proton…) on `/team`, with their pôle or not,
  and sends them the message shown (link + one-time access code, valid 7 days); they choose
  their password with it. Admin rights: tick *Admin* on `/team` once they signed in.
- **Forgotten password**: an admin clicks *Nouveau code* next to the person on `/team` and sends it.
- **Change texts, examples, colours**: edit `content/boxhero.json` (keep FR and EN keys in sync — a test checks it).
- **Database changes**: add a new file in `supabase/migrations/`, test with `npm run db:test`, deploy with `npx supabase db push`.

## Slack: send the memo to the people of the call

In the memo, the *L'appel* panel holds the call's date and people. **Send on
Slack** sends each of them (and the decision maker) a direct message with a
button to the memo. To connect it (a Slack admin, once):

1. https://api.slack.com/apps → *Create New App* → *From a manifest* → pick the
   BoxHero workspace → paste `slack/manifest.json` → *Create*.
2. *Install to Workspace* → *Allow*.
3. *OAuth & Permissions* → copy the *Bot User OAuth Token* (`xoxb-…`) into
   Vercel as `SLACK_BOT_TOKEN` (Production and Preview), then redeploy.

People are found on Slack by the email they use in the app.

## Calendar on the home page

*Mes prochains appels* lists the next 14 days of the person's calendar and the
memos of calls they are in, with *Rejoindre* for the video link; *Prepare the
memo* creates the memo of an event with its title, date and attendees. Each
person connects their own calendar once:

- **Connecter Google Agenda**: one click, Google asks which account and to allow
  *see your calendar events* (read only), done. The server keeps a refresh token,
  encrypted with `GOOGLE_TOKEN_KEY`; *Déconnecter* revokes it at Google.
- **Autre agenda** (Proton, Outlook…): the calendar's private share link. It stays
  private (only its owner and the server read it).

### Google Calendar: set up once (Google Cloud console)

1. https://console.cloud.google.com → create a project (e.g. *BoxHero Memo*).
2. *APIs & Services → Library* → **Google Calendar API** → *Enable*.
3. *Google Auth Platform* (OAuth consent screen) → *Get started*: app name *Mémo BoxHero*,
   support email, audience **External**, contact email → *Create*.
   *Data access* → *Add or remove scopes* → `.../auth/calendar.events.readonly` → *Save*.
   *Audience* → **Publish app** (*In production*; while *Testing*, Google stops the
   access after 7 days and only lists test users).
4. *Clients* → *Create client* → **Web application**; *Authorized redirect URIs*:
   `https://<production-domain>/api/google/callback` → *Create*; copy the client ID
   and the client secret.
5. Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY`
   (`openssl rand -base64 32`) and `NEXT_PUBLIC_SITE_URL=https://<production-domain>`,
   then redeploy.

Until Google reviews the app (only needed above 100 people), its screen first says
*Google hasn't verified this app*: *Advanced* → *Go to Mémo BoxHero*. It is shown
once per person.

## Phase 2: Send to Asana

With `ASANA_ACCESS_TOKEN` (a service account or personal access token) and
`ASANA_PROJECT_GID` (the *Memos* project) set on the server, the editor shows
**Send to Asana**: it creates (or updates) a task in that project, assigned to
the decision maker (matched by email, or by `profiles.asana_user_gid`), with
the memo as the description and a link back to the app. The token stays on
the server. Without the variables the button is hidden; **Copy for Asana**
always works.

---
© 2026 BoxHero · All rights reserved · by Khalifa, COO
