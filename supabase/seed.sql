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
-- ##   Then give Khalifa a first access code (he chooses his password with it on          ##
-- ##   /login → "Première connexion"); see README "Deploy". Everyone else is invited from   ##
-- ##   /team in the app (admins only), which gives their code. Until someone is             ##
-- ##   invited NOBODY can sign up (the check fails closed). A whole company domain can     ##
-- ##   also be allowed: insert into private.allowed_email_domains (domain) values (…) —     ##
-- ##   never a public provider (gmail, proton…). To remove a person who already signed in,  ##
-- ##   take away their teams / admin rights on /team and ban or delete them in Supabase.    ##
-- ##                                                                                       ##
-- ###########################################################################################

-- Placeholder domain for local dev and e2e (.test is reserved: it never receives mail).
insert into private.allowed_email_domains (domain)
values ('boxhero.test')
on conflict do nothing;

-- Local stand-ins for Mattéo and Khalifa, so an admin exists in dev and e2e.
insert into private.bootstrap_admins (email)
values ('matteo@boxhero.test'), ('khalifa@boxhero.test')
on conflict do nothing;

-- Their first password, locally: /login → "Première connexion ou mot de passe oublié ?",
-- address matteo@boxhero.test or khalifa@boxhero.test, access code LOCAL-DEV.
insert into private.access_codes (email, code_hash, expires_at)
values
  ('matteo@boxhero.test', extensions.crypt('LOCALDEV', extensions.gen_salt('bf', 8)), now() + interval '1 year'),
  ('khalifa@boxhero.test', extensions.crypt('LOCALDEV', extensions.gen_salt('bf', 8)), now() + interval '1 year')
on conflict (email) do nothing;
