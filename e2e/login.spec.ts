// Sign-in page (/login) and the whole magic-link round trip through the local
// mail sink (MAIL_API_URL, see the stack README: GET /messages/latest).
import { expect, test } from "@playwright/test";
import { admin, cleanupUser, ensureUser, signIn } from "./support";

const mailApi = process.env.MAIL_API_URL ?? "http://localhost:2501";
const USER = "ls-login@boxhero.test";

/** Newest email to `to` received after `since`, waiting up to 15 s. */
async function latestLink(to: string, since: number): Promise<string> {
  const res = await fetch(`${mailApi}/messages/latest?to=${encodeURIComponent(to)}&since=${since}&wait=15000`);
  expect(res.status, "an email arrived").toBe(200);
  const message = (await res.json()) as { links: string[] };
  const link = message.links.find((l) => l.includes("token_hash="));
  expect(link, "the email holds a sign-in link").toBeTruthy();
  return link!;
}

// One email per address per test: GoTrue refuses a second one within 1 s.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureUser(USER, { fullName: "Lou Login", teams: ["sav"] });
  // ensureUser's generateLink counts as a sent link for GoTrue's 1 s per-address limit.
  await new Promise((r) => setTimeout(r, 1100));
});
test.afterAll(async () => {
  await cleanupUser(USER);
});

test("signed out: the list sends you to /login, and back after signing in", async ({ page }) => {
  await page.goto("/");
  // "/" is the default destination, so it is not repeated in the URL.
  await expect(page).toHaveURL("/login");
  await page.goto("/?team=sav&status=decided");
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/?team=sav&status=decided")}`);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.locator("#hTitle")).toHaveText(/Le mémo\s*BoxHero/i);
  // No team pills and no account on this page.
  await expect(page.locator(".poles")).toHaveCount(0);
  await expect(page.locator(".acct")).toHaveCount(0);

  const field = page.getByLabel("Ton adresse e-mail");
  await expect(field).toHaveAttribute("placeholder", "prenom@gmail.com");

  const since = Date.now();
  await field.fill(USER.toUpperCase());
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  const status = page.getByRole("status").filter({ hasText: "C’est envoyé" });
  await expect(status).toContainText(`C’est envoyé. Ouvre le lien reçu à ${USER}.`);
  await expect(status).toContainText("Rien reçu ? Regarde dans les spams");

  const link = await latestLink(USER, since);
  expect(new URL(link).origin).toBe(new URL(page.url()).origin);
  await page.goto(link);
  // Lands where the visitor was going, signed in.
  await expect(page).toHaveURL("/?team=sav&status=decided");
  await expect(page.locator(".hero .acct button")).toHaveText("Se déconnecter");
  await expect(page.locator(".lst-tabs a[aria-current=page]")).toHaveText("Décidé");

  // Signed in, /login sends you on.
  await page.goto("/login");
  await expect(page).toHaveURL("/");
});

test("bad addresses get a clear message and keep what was typed", async ({ page }) => {
  await page.goto("/login");
  const field = page.getByLabel("Ton adresse e-mail");
  const send = page.getByRole("button", { name: "Recevoir le lien" });

  await field.fill("not an email");
  await send.click();
  await expect(page.locator("#login-msg")).toHaveText("Cette adresse ne ressemble pas à un e-mail.");
  await expect(field).toHaveValue("not an email");
  await expect(field).toHaveAttribute("aria-invalid", "true");

  await field.fill("ls-someone@gmail.com");
  await send.click();
  await expect(page.locator("#login-msg")).toHaveText("Cette adresse n’est pas invitée. Demande à Khalifa ou Mattéo de t’ajouter (page L’équipe).");
  await expect(field).toHaveValue("ls-someone@gmail.com");

  // A look-alike domain is not the domain (nor an invitation).
  await field.fill("ls-someone@boxhero.test.evil.com");
  await send.click();
  await expect(page.locator("#login-msg")).toHaveText("Cette adresse n’est pas invitée. Demande à Khalifa ou Mattéo de t’ajouter (page L’équipe).");
});

test("errors from the URL", async ({ page }) => {
  await page.goto("/login?error=auth");
  await expect(page.locator("#login-msg")).toHaveText("Le lien a expiré ou a déjà servi. Demande-en un nouveau.");
  await page.goto("/login?error=profile");
  await expect(page.locator("#login-msg")).toHaveText("Ton compte n’est pas prêt : écris à Khalifa ou Mattéo.");
  await page.goto("/login?error=whatever");
  await expect(page.locator("#login-msg")).toHaveText("L’envoi a échoué : réessaie.");
  await page.goto("/login");
  await expect(page.locator("#login-msg")).toBeEmpty();
});

test("an expired or used link comes back with the auth error", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=pkce_0000000000000000&type=email");
  await expect(page).toHaveURL(/\/login\?error=auth/);
  await expect(page.locator("#login-msg")).toHaveText("Le lien a expiré ou a déjà servi. Demande-en un nouveau.");
});

test("FR/EN switch on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.locator(".lang button[data-l=en]").click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Your email address")).toHaveAttribute("placeholder", "firstname@gmail.com");
  await page.getByLabel("Your email address").fill("nope");
  await page.getByRole("button", { name: "Send me the link" }).click();
  await expect(page.locator("#login-msg")).toHaveText("That doesn’t look like an email address.");
  await page.locator(".lang button[data-l=fr]").click();
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});

test("sign out from the account pill returns to /login", async ({ page }) => {
  await signIn(page, USER);
  await expect(page).toHaveURL("/");
  await page.locator(".hero .acct button").click();
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("a session without a profile ends on /login?error=profile, with a way to sign out", async ({ page }) => {
  const email = "fd-noprofile@boxhero.test";
  const { id } = await ensureUser(email, { teams: [] });
  try {
    await signIn(page, email);
    await expect(page).toHaveURL("/");
    // The profile row disappears (it should never happen, but then nothing works).
    const { error } = await admin().from("profiles").delete().eq("id", id);
    expect(error).toBeNull();
    await page.goto("/team");
    await expect(page).toHaveURL("/login?error=profile");
    await expect(page.locator("#login-msg")).toHaveText("Ton compte n’est pas prêt : écris à Khalifa ou Mattéo.");
    const signOut = page.getByRole("button", { name: "Se déconnecter" });
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
    // Signed out for real: the list sends you to /login again.
    await page.goto("/team");
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/team")}`);
  } finally {
    await admin().auth.admin.deleteUser(id);
  }
});

test("the login page has its own title, and no sign-out button without the profile error", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(/^Connexion( · Mémo BoxHero)?$/);
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
  await page.goto("/login?error=auth");
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
  await page.locator(".lang button[data-l=en]").click();
  await expect(page).toHaveTitle(/^Sign in( · Mémo BoxHero)?$/);
  await page.locator(".lang button[data-l=fr]").click();
});

test("phone width: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login?error=auth");
  await expect(page.locator("#login-msg")).not.toBeEmpty();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
