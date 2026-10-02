# Mémo BoxHero

*Pas de mémo, pas de réunion.* The BoxHero decision memo app: write a memo
(Why, What, How, Now, Questions — or the ad mini memo), send it to the person
who decides, and get their answers in the app.

Next.js 16 (App Router, TypeScript) on **Vercel** · **Supabase** (Postgres,
magic-link Auth restricted to BoxHero emails, Row Level Security).
The design is the original prototype's, unchanged. How it works:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's where

| | |
|---|---|
| `content/boxhero.json` | **Every text** (FR + EN), the examples, the guide, team colours and cover images. Edit it to change copy — no component changes needed. |
| `public/covers/` | Team cover images (hero + PDF cover). |
| `src/app/` | Pages: `/` list, `/memos/new`, `/memos/[id]`, `/team`, `/login`. |
| `supabase/migrations/` | Database schema, RLS policies, workflow rules. |
| `supabase/templates/` | The sign-in emails. |

Statuses: **Brouillon / Draft → À décider / To decide → Décidé / Decided**, and
**Archivé / Archived**. The author writes and sends for decision; the decision
maker answers each question in the app and marks it decided.

Who sees what (enforced by the database): everyone sees their teams' memos plus
the ones they wrote or must decide; admins (Mattéo, Khalifa) see everything and
manage teams on `/team`.

## Run it locally

Requirements: Node 20.9+ and the [Supabase CLI](https://supabase.com/docs/guides/local-development) with Docker.

```bash
npm install
npx supabase start                # local Postgres + Auth + Mailpit, applies migrations + seed
cp .env.example .env.local        # then paste the URL and publishable/anon key printed by `supabase start`
npm run dev                       # http://localhost:3000
```

Sign in with any `@boxhero.test` address (the local seed allows that domain;
`matteo@boxhero.test` and `khalifa@boxhero.test` are admins). The email arrives
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
3. **Before anyone signs in**, in *SQL Editor*, allow the BoxHero email domain(s)
   — and/or single addresses outside it — and name the first admins (lower case).
   Until then nobody can sign up.
   ```sql
   insert into private.allowed_email_domains (domain) values ('<boxhero-domain>') on conflict do nothing;
   insert into private.allowed_emails (email) values ('<one-person@another-domain>') on conflict do nothing;  -- optional
   insert into private.bootstrap_admins (email) values ('<matteo-email>'), ('<khalifa-email>') on conflict do nothing;
   ```
4. *Authentication → URL Configuration*
   - Site URL: `https://<production-domain>`
   - Redirect URLs: `https://<production-domain>/auth/confirm`,
     `https://*-<vercel-team-slug>.vercel.app/auth/confirm` (preview deployments),
     `http://localhost:3000/auth/confirm`
5. *Authentication → Emails → Templates*: paste `supabase/templates/magic_link.html`
   into **Magic Link** and `supabase/templates/confirmation.html` into **Confirm signup**
   (subjects as in `supabase/config.toml`). Both links are
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`, so a link works on any device.
6. *Authentication → Emails → SMTP*: set up a custom SMTP sender (Supabase's
   built-in sender only allows a few emails per hour), then review *Rate Limits*.

### 2. Vercel

1. *Add New → Project*, import this GitHub repository (framework: Next.js).
   Production branch `main`; every pull request gets a preview deployment.
2. *Settings → Environment Variables* (Production and Preview):

   | variable | value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase *Project Settings → API* URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
   | `ALLOWED_EMAIL_DOMAINS` | same list as step 1.3, comma-separated: domains and/or exact addresses |
   | `NEXT_PUBLIC_SITE_URL` | optional, production URL |
   | `ASANA_ACCESS_TOKEN`, `ASANA_PROJECT_GID` | phase 2, optional (see below) |

   No secret is exposed to the browser: the publishable key is public by design
   and the data is protected by RLS. Never add the service-role key.
3. Deploy, then sign in with your BoxHero email.

### Day to day

- **Add someone**: they sign in with their BoxHero email, then an admin ticks their teams on `/team`.
- **Change texts, examples, colours**: edit `content/boxhero.json` (keep FR and EN keys in sync — a test checks it).
- **Database changes**: add a new file in `supabase/migrations/`, test with `npm run db:test`, deploy with `npx supabase db push`.

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
