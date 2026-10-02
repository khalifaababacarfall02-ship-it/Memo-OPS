-- Local development / e2e seed. Loaded by `supabase start` / `supabase db reset` and by
-- scripts/db-test.sh. It is NEVER run on the hosted project (`supabase db push` skips it).
--
-- ###########################################################################################
-- ##                                                                                       ##
-- ##   BEFORE THE FIRST PRODUCTION SIGN-IN, run this in the Supabase SQL editor             ##
-- ##   (Dashboard > SQL Editor), with the real address (lower case):                        ##
-- ##                                                                                       ##
-- ##     insert into public.invitations (email) values ('<khalifa-email>')                  ##
-- ##     on conflict do nothing;                                                            ##
-- ##     insert into private.bootstrap_admins (email) values ('<khalifa-email>')            ##
-- ##     on conflict do nothing;                                                            ##
-- ##                                                                                       ##
-- ##   Everyone else is then invited from /team in the app (admins only). Until someone is  ##
-- ##   invited NOBODY can sign up (the check fails closed). A whole company domain can     ##
-- ##   also be allowed: insert into private.allowed_email_domains (domain) values (…) —     ##
-- ##   never a public provider (gmail, proton…). To remove a person who already signed in,  ##
-- ##   take away their teams / admin rights on /team and ban or delete them in Supabase.    ##
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
