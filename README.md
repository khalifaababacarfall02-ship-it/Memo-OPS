# Mémo BoxHero

*Pas de mémo, pas de réunion.* The BoxHero decision memo app: write a memo
(Why, What, How, Now, Questions — or the ad mini memo), send it to the person
who decides, and get their answers in the app.

Next.js 16 (App Router, TypeScript) on **Vercel** · **Supabase** (Postgres,
magic-link Auth for invited people only, Row Level Security). Memos are for calls:
the people of the call read the memo before it, get it on **Slack**, and everyone
sees their next calls from their **calendar** (Google or Proton) on the home page.
The design is the original prototype's, unchanged. How it works:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's where

| | |
|---|---|
| `content/boxhero.json` | **Every text** (FR + EN), the examples, the guide, team colours and cover images. Edit it to change copy — no component changes needed. |
| `public/covers/` | Team cover images (hero + PDF cover). |
| `src/app/` | Pages: `/` next calls + list, `/memos/new`, `/memos/[id]`, `/team`, `/welcome` (first sign-in), `/login`. |
| `slack/manifest.json` | The Slack app to install (sends memos by direct message). |
| `supabase/migrations/` | Database schema, RLS policies, workflow rules. |
| `supabase/templates/` | The sign-in emails. |

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

Sign in with any `@boxhero.test` address (the local seed allows that domain;
`matteo@boxhero.test` and `khalifa@boxhero.test` are admins). The first sign-in
asks for a name and a pôle. The email arrives
in Mailpit: http://127.0.0.1:54324.

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
3. **Before anyone signs in**, in *SQL Editor*, invite the first admin and make
   them admin (lower case). Everyone else is then invited from `/team` in the app.
   ```sql
   insert into public.invitations (email) values ('<khalifa-email>') on conflict do nothing;
   insert into private.bootstrap_admins (email) values ('<khalifa-email>') on conflict do nothing;
   ```
4. *Authentication → URL Configuration*
   - Site URL: `https://<production-domain>`
   - Redirect URLs: `https://<production-domain>/auth/confirm`,
     `https://*-<vercel-team-slug>.vercel.app/auth/confirm` (preview deployments),
     `http://localhost:3000/auth/confirm`
5. *Authentication → Emails → SMTP Settings*: set up a sender. Supabase's
   built-in one sends **2 emails per hour for the whole project**: not enough for
   a team. With a Gmail account: create an app password (Google Account →
   Security → 2-Step Verification → App passwords), then host `smtp.gmail.com`,
   port `465`, user and sender = that Gmail address, password = the app password.
   Then review *Rate Limits*.
6. *Authentication → Emails → Templates*: paste `supabase/templates/magic_link.html`
   into **Magic Link** and `supabase/templates/confirmation.html` into **Confirm signup**
   (subjects as in `supabase/config.toml`). Both links are
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`, so a link works on any device
   (with the default template, it only works in the browser that asked for it).

### 2. Vercel

1. *Add New → Project*, import this GitHub repository (framework: Next.js).
   Production branch `main`; every pull request gets a preview deployment.
2. *Settings → Environment Variables* (Production and Preview):

   | variable | value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase *Project Settings → API* URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
   | `NEXT_PUBLIC_SITE_URL` | optional, production URL |
   | `SLACK_BOT_TOKEN` | optional: the Slack app's bot token (see below) |
   | `ASANA_ACCESS_TOKEN`, `ASANA_PROJECT_GID` | phase 2, optional (see below) |

   No secret is exposed to the browser: the publishable key is public by design
   and the data is protected by RLS. Never add the service-role key.
3. Deploy, then sign in with your BoxHero email.

### Day to day

- **Add someone**: an admin invites their email (Gmail, Proton…) on `/team`, with their pôle or not;
  they sign in at the app's address with it. Admin rights: tick *Admin* on `/team` once they signed in.
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
memos of calls they are in; *Prepare the memo* creates the memo of an event with
its title, date and attendees. Each person connects their own calendar once
(*Connecter mon agenda*): Google Calendar's *Secret address in iCal format*, or a
Proton Calendar share link. The link stays private (only its owner and the server
read it).

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
