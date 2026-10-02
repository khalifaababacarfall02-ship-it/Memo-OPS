// Sign-in page (/login): address + password, and "choose my password" with the
// access code an admin gives (first time, or forgotten password). No email is sent.
import { expect, test } from "@playwright/test";
import { content } from "../src/lib/content";
import { accessCodeFor, admin, cleanupUser, ensureUser, setPassword, signIn } from "./support";

const fr = content.fr.ui;
const en = content.en.ui;
const USER = "ls-login@boxhero.test";
const PASSWORD = "Lou-Login-2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureUser(USER, { fullName: "Lou Login", teams: ["sav"] });
  await setPassword(USER, PASSWORD);
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
  await expect(page.getByRole("heading", { name: fr.loginH, exact: true })).toBeVisible();
  await expect(page.locator("#hTitle")).toHaveText(/Le mémo\s*BoxHero/i);
  // No sidebar, no team pills and no account on this page.
  await expect(page.locator(".side")).toHaveCount(0);
  await expect(page.locator(".poles")).toHaveCount(0);
  await expect(page.locator(".acct")).toHaveCount(0);

  const field = page.getByLabel(fr.emailL);
  await expect(field).toHaveAttribute("placeholder", "prenom@gmail.com");
  await expect(field).toHaveAttribute("autocomplete", "username");
  const password = page.locator("#login-password");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  // "Afficher" shows what was typed, "Masquer" hides it again.
  await password.fill(PASSWORD);
  await page.getByRole("button", { name: fr.showPassword }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: fr.hidePassword }).click();
  await expect(password).toHaveAttribute("type", "password");

  await field.fill(` ${USER.toUpperCase()} `);
  await page.getByRole("button", { name: fr.signIn, exact: true }).click();
  // Lands where the visitor was going, signed in.
  await expect(page).toHaveURL("/?team=sav&status=decided");
  await expect(page.locator(".acct button")).toHaveText("Se déconnecter");
  await expect(page.locator(".lst-tabs a[aria-current=page]")).toHaveText("Décidé");

  // Signed in, /login sends you on.
  await page.goto("/login");
  await expect(page).toHaveURL("/");
});

test("missing or wrong details get a clear message and keep the address", async ({ page }) => {
  await page.goto("/login");
  const field = page.getByLabel(fr.emailL);
  const password = page.locator("#login-password");
  const send = page.locator("#loginSubmit");

  await field.fill("not an email");
  await send.click();
  await expect(page.locator("#login-msg")).toHaveText(fr.badEmail);
  await expect(field).toHaveValue("not an email");
  await expect(field).toHaveAttribute("aria-invalid", "true");

  await field.fill(USER);
  await send.click();
  await expect(page.locator("#login-msg")).toHaveText(fr.needPassword);
  await expect(password).toHaveAttribute("aria-invalid", "true");

  await password.fill("pas-le-bon-mot-de-passe");
  await send.click();
  await expect(page.locator("#login-msg")).toHaveText(fr.badCredentials);
  await expect(field).toHaveValue(USER);
  // An address nobody invited gets the same answer (no way to test who has an account).
  await field.fill("ls-someone@gmail.com");
  await password.fill("n-importe-quoi");
  await send.click();
  await expect(page.locator("#login-msg")).toHaveText(fr.badCredentials);
  await expect(page).toHaveURL("/login");
});

test("forgotten password: a new code from an admin, a new password", async ({ page, browser }) => {
  // The admin's side: "Nouveau code" on the person's row of /team.
  const adminEmail = "ls-login-admin@boxhero.test";
  await ensureUser(adminEmail, { fullName: "Ada Admin", isAdmin: true, teams: ["ops"] });
  const adminCtx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "fr-FR" });
  const adminPage = await adminCtx.newPage();
  await signIn(adminPage, adminEmail, "/team");
  await adminPage.locator(`tr[data-email="${USER}"] .tm-code`).click();
  const dialog = adminPage.getByRole("dialog");
  await expect(dialog).toContainText("Code d’accès de Lou Login");
  const code = ((await adminPage.locator("#codeValue").textContent()) ?? "").trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(adminPage.locator("#codeMessage")).toHaveValue(new RegExp(`/login\\?setup=1&email=${encodeURIComponent(USER)}`));
  await adminCtx.close();

  // The person's side: "Première connexion ou mot de passe oublié ?" keeps the address typed.
  await page.goto("/login");
  await page.getByLabel(fr.emailL).fill(USER);
  await page.locator("#loginSetup").click();
  await expect(page.getByRole("heading", { name: fr.setupH, exact: true })).toBeVisible();
  await expect(page.locator("#login-email")).toHaveValue(USER);
  await page.locator("#setupSubmit").click();
  await expect(page.locator("#login-msg")).toHaveText(fr.needCode);
  await page.locator("#login-code").fill(code);
  await page.locator("#login-new-password").fill("Lou-Nouveau-2026");
  await page.locator("#login-confirm").fill("Lou-Nouveau-2026");
  await page.locator("#setupSubmit").click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".acct-mail")).toHaveText(USER);

  // The old password is gone, the new one works.
  await page.locator(".acct button").click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel(fr.emailL).fill(USER);
  await page.locator("#login-password").fill(PASSWORD);
  await page.locator("#loginSubmit").click();
  await expect(page.locator("#login-msg")).toHaveText(fr.badCredentials);
  await page.locator("#login-password").fill("Lou-Nouveau-2026");
  await page.locator("#loginSubmit").click();
  await expect(page).toHaveURL("/");
  await page.locator(".acct button").click();
  await setPassword(USER, PASSWORD);
});

test("a code locks after 5 wrong tries; a new code starts over", async ({ page }) => {
  const code = await accessCodeFor(USER);
  await page.goto(`/login?setup=1&email=${encodeURIComponent(USER)}`);
  const typePasswords = async () => {
    // A sent form empties its password fields (the address and the code stay).
    await page.locator("#login-new-password").fill("Lou-Essai-2026");
    await page.locator("#login-confirm").fill("Lou-Essai-2026");
  };
  for (let i = 0; i < 5; i++) {
    await page.locator("#login-code").fill(`ZZZZ-ZZZ${i + 2}`);
    await typePasswords();
    await page.locator("#setupSubmit").click();
    await expect(page.locator("#login-msg")).toHaveText(fr.codeInvalid);
  }
  await page.locator("#login-code").fill(code);
  await typePasswords();
  await page.locator("#setupSubmit").click();
  await expect(page.locator("#login-msg")).toHaveText(fr.codeLocked);

  // The admin's "Nouveau code" replaces the locked one. (Expiry: see the database tests.)
  const fresh = await accessCodeFor(USER);
  await page.locator("#login-code").fill(fresh);
  await typePasswords();
  await page.locator("#setupSubmit").click();
  await expect(page).toHaveURL("/");
  await page.locator(".acct button").click();
  await setPassword(USER, PASSWORD);
});

test("errors from the URL", async ({ page }) => {
  await page.goto("/login?error=auth");
  await expect(page.locator("#login-msg")).toHaveText(fr.authError);
  await page.goto("/login?error=profile");
  await expect(page.locator("#login-msg")).toHaveText(fr.profileMissing);
  await page.goto("/login?error=whatever");
  await expect(page.locator("#login-msg")).toHaveText(fr.loginError);
  await page.goto("/login");
  await expect(page.locator("#login-msg")).toBeEmpty();
});

test("an old or used email link comes back with the auth error", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=pkce_0000000000000000&type=email");
  await expect(page).toHaveURL(/\/login\?error=auth/);
  await expect(page.locator("#login-msg")).toHaveText(fr.authError);
});

test("FR/EN switch on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.locator(".lang button[data-l=en]").click();
  await expect(page.getByRole("heading", { name: en.loginH, exact: true })).toBeVisible();
  await expect(page.getByLabel(en.emailL)).toHaveAttribute("placeholder", "firstname@gmail.com");
  await page.getByLabel(en.emailL).fill("nope");
  await page.getByRole("button", { name: en.signIn, exact: true }).click();
  await expect(page.locator("#login-msg")).toHaveText(en.badEmail);
  await page.locator("#loginSetup").click();
  await expect(page.getByRole("heading", { name: en.setupH, exact: true })).toBeVisible();
  // The form stays the one that was open.
  await page.locator(".lang button[data-l=fr]").click();
  await expect(page.getByRole("heading", { name: fr.setupH, exact: true })).toBeVisible();
});

test("sign out from the account menu returns to /login", async ({ page }) => {
  await signIn(page, USER);
  await expect(page).toHaveURL("/");
  await page.locator(".acct button").click();
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
    await expect(page.locator("#login-msg")).toHaveText(fr.profileMissing);
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
  for (const path of ["/login?error=auth", "/login?setup=1"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
