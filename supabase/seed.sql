-- Local development / e2e seed. Loaded by `supabase start` / `supabase db reset` and by
-- scripts/db-test.sh. It is NEVER run on the hosted project (`supabase db push` skips it).
--
-- ###########################################################################################
-- ##                                                                                       ##
-- ##   BEFORE THE FIRST PRODUCTION SIGN-IN, run this in the Supabase SQL editor             ##
-- ##   (Dashboard > SQL Editor), with the real values:                                      ##
-- ##                                                                                       ##
-- ##     -- 1. Who may sign in: every BoxHero email domain, lower case, no "@".             ##
-- ##     insert into private.allowed_email_domains (domain)                                 ##
-- ##     values ('<boxhero-domain>')                -- e.g. the domain of your work email   ##
-- ##     on conflict do nothing;                                                            ##
-- ##                                                                                       ##
-- ##     -- 2. Who starts as admin (sees every memo, manages teams): Mattéo and Khalifa.    ##
-- ##     insert into private.bootstrap_admins (email)                                       ##
-- ##     values ('<matteo-email>'), ('<khalifa-email>')   -- lower case                     ##
-- ##     on conflict do nothing;                                                            ##
-- ##                                                                                       ##
-- ##   Until step 1 is done NOBODY can sign up (the check fails closed). Step 2 works in    ##
-- ##   any order: an existing profile is promoted as soon as its email is added.            ##
-- ##   Keep ALLOWED_EMAIL_DOMAINS (Vercel env) equal to the list of step 1.                 ##
-- ##   Removing a domain later blocks new sign-ups only; to remove a person, take away      ##
-- ##   their teams / admin rights on /team and ban or delete them in Supabase Auth.         ##
-- ##                                                                                       ##
-- ###########################################################################################

-- Placeholder domain for local dev and e2e (.test is reserved: it never receives mail).
-- Local sign-in emails land in Mailpit (http://127.0.0.1:54324).
insert into private.allowed_email_domains (domain)
values ('boxhero.test')
on conflict do nothing;

-- Local stand-ins for Mattéo and Khalifa, so an admin exists in dev and e2e.
insert into private.bootstrap_admins (email)
values ('matteo@boxhero.test'), ('khalifa@boxhero.test')
on conflict do nothing;
