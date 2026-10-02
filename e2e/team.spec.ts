// /team against the local stack: admins change teams and admin rights, the
// change reaches RLS at once, non-admins cannot change anything (not even
// with direct API calls from their browser session), display names persist.
// Run: E2E_BASE_URL=http://localhost:3203 npx playwright test e2e/team.spec.ts
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import { content } from "../src/lib/content";
import { admin, cleanupUser, ensureUser, seedMemo, signIn } from "./support";

const fr = content.fr.ui;
const ADMIN = "tm-admin@boxhero.test";
const MEMBER = "tm-member@boxhero.test";
const AUTHOR = "tm-author@boxhero.test";
const USERS = [ADMIN, MEMBER, AUTHOR];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let ids: Record<string, string> = {};
let financeMemo = "";
const financeTitle = `tm finance ${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ids = {
    [ADMIN]: (await ensureUser(ADMIN, { fullName: "Tim Admin", teams: [], isAdmin: true })).id,
    [MEMBER]: (await ensureUser(MEMBER, { fullName: "Tess Membre", teams: [], isAdmin: false })).id,
    [AUTHOR]: (await ensureUser(AUTHOR, { fullName: "Théo Auteur", teams: ["finance"], isAdmin: false })).id,
  };
  financeMemo = await seedMemo({ team: "finance", lang: "fr", title: financeTitle, author_id: ids[AUTHOR] });
});

test.afterAll(async () => {
  const a = admin();
  for (const email of USERS) await cleanupUser(email);
  const userIds = Object.values(ids);
  if (userIds.length) {
    await a.from("team_members").delete().in("user_id", userIds);
    await a.from("profiles").update({ is_admin: false }).in("id", userIds);
    for (const id of userIds) await a.auth.admin.deleteUser(id);
  }
});

async function newPage(browser: import("@playwright/test").Browser, email: string, next = "/team") {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "fr-FR" });
  const page = await context.newPage();
  await signIn(page, email, next);
  return { context, page };
}

/** The browser's own Supabase access token (from the @supabase/ssr cookie). */
async function accessToken(context: BrowserContext): Promise<string> {
  const chunks = (await context.cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()));
  let raw = chunks.map((c) => c.value).join("");
  raw = decodeURIComponent(raw);
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  return (JSON.parse(raw) as { access_token: string }).access_token;
}

/** A PostgREST call made by the page itself, as the signed-in person (publishable key + their JWT). */
async function rest(page: Page, token: string, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ url, key, token, method, path, body }) => {
      const res = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    { url: SUPABASE_URL, key: ANON_KEY, token, method, path, body },
  );
}

const row = (page: Page, email: string) => page.locator(`tr[data-email="${email}"]`);
const toast = (page: Page) => page.locator(".toast.show");

/** Can `page`'s user read the memo through RLS? */
async function sees(page: Page, token: string, memoId: string): Promise<boolean> {
  const r = await rest(page, token, "GET", `memos?select=id&id=eq.${memoId}`);
  expect(r.status).toBe(200);
  return (r.body as unknown[]).length === 1;
}

/** The list view is built separately; until it lands "/" is a placeholder. */
async function listShows(page: Page, title: string): Promise<boolean | null> {
  await page.goto("/");
  const sheet = (await page.locator("main").first().innerText()).trim();
  if (sheet === "BoxHero") return null;
  return page.getByText(title).first().isVisible();
}

test("an admin adds a member to a team: the member sees its memos at once, and stops seeing them when removed", async ({
  browser,
}) => {
  const a = await newPage(browser, ADMIN);
  const m = await newPage(browser, MEMBER, "/");
  const memberToken = await accessToken(m.context);
  expect(await sees(m.page, memberToken, financeMemo)).toBe(false);

  await a.page.goto("/team");
  const memberRow = row(a.page, MEMBER);
  await expect(memberRow).toContainText("Tess Membre");
  await expect(memberRow).toContainText(fr.noTeamYet);
  const finance = memberRow.getByRole("checkbox", { name: fr.poles.finance });
  await expect(finance).toBeEnabled();
  await expect(finance).not.toBeChecked();

  await finance.check();
  await expect(toast(a.page)).toHaveText(fr.teamSaved);
  await expect(memberRow).not.toContainText(fr.noTeamYet);
  const { data: rows } = await admin().from("team_members").select("team").eq("user_id", ids[MEMBER]);
  expect(rows).toEqual([{ team: "finance" }]);

  // RLS, immediately, with the member's own browser session.
  expect(await sees(m.page, memberToken, financeMemo)).toBe(true);
  const shown = await listShows(m.page, financeTitle);
  if (shown !== null) expect(shown).toBe(true);

  // After a reload the admin still sees the saved state.
  await a.page.reload();
  await expect(row(a.page, MEMBER).getByRole("checkbox", { name: fr.poles.finance })).toBeChecked();

  await row(a.page, MEMBER).getByRole("checkbox", { name: fr.poles.finance }).uncheck();
  await expect(toast(a.page)).toHaveText(fr.teamSaved);
  expect(await sees(m.page, memberToken, financeMemo)).toBe(false);
  const hidden = await listShows(m.page, financeTitle);
  if (hidden !== null) expect(hidden).toBe(false);

  await a.context.close();
  await m.context.close();
});

test("an admin grants and removes admin rights", async ({ browser }) => {
  const a = await newPage(browser, ADMIN);
  const adminBox = row(a.page, MEMBER).getByRole("checkbox", { name: fr.adminL });
  await adminBox.check();
  await expect(toast(a.page)).toHaveText(fr.teamSaved);
  let { data } = await admin().from("profiles").select("is_admin").eq("id", ids[MEMBER]).single();
  expect(data?.is_admin).toBe(true);

  await adminBox.uncheck();
  await expect(toast(a.page)).toHaveText(fr.teamSaved);
  ({ data } = await admin().from("profiles").select("is_admin").eq("id", ids[MEMBER]).single());
  expect(data?.is_admin).toBe(false);
  await a.context.close();
});

test("a non-admin sees the same list read-only and cannot change anything, even through the API", async ({
  browser,
}) => {
  const m = await newPage(browser, MEMBER);
  await expect(m.page.locator("tr.me")).toHaveAttribute("data-email", MEMBER);
  await expect(m.page.locator("tr.me")).toContainText(fr.you);
  await expect(row(m.page, ADMIN)).toBeVisible();
  // Everyone is listed with their rights: useful to know who decides.
  await expect(row(m.page, ADMIN).getByRole("checkbox", { name: fr.adminL })).toBeChecked();
  await expect(row(m.page, AUTHOR).getByRole("checkbox", { name: fr.poles.finance })).toBeChecked();
  const boxes = m.page.locator("tbody input[type=checkbox]");
  expect(await boxes.count()).toBeGreaterThan(7);
  expect(await m.page.locator("tbody input[type=checkbox]:not(:disabled)").count()).toBe(0);
  await expect(m.page.getByText(fr.noTeam)).toBeVisible();

  // Direct writes with the member's own session, from the page.
  const token = await accessToken(m.context);
  const join = await rest(m.page, token, "POST", "team_members", { user_id: ids[MEMBER], team: "ops" });
  expect(join.status).toBe(403);
  expect(join.body.code).toBe("42501");

  const promote = await rest(m.page, token, "PATCH", `profiles?id=eq.${ids[MEMBER]}`, { is_admin: true });
  expect(promote.status).toBe(403);
  expect(promote.body.message).toBe("only an admin can change admin rights");

  const demote = await rest(m.page, token, "PATCH", `profiles?id=eq.${ids[ADMIN]}`, { is_admin: false });
  expect(demote.status).toBe(200);
  expect(demote.body).toEqual([]); // RLS: someone else's row is not updatable.

  const kick = await rest(m.page, token, "DELETE", `team_members?user_id=eq.${ids[AUTHOR]}`);
  expect(kick.status).toBe(200);
  expect(kick.body).toEqual([]);

  const a = admin();
  expect((await a.from("team_members").select("team").eq("user_id", ids[MEMBER])).data).toEqual([]);
  expect((await a.from("team_members").select("team").eq("user_id", ids[AUTHOR])).data).toEqual([{ team: "finance" }]);
  expect((await a.from("profiles").select("is_admin").eq("id", ids[ADMIN]).single()).data?.is_admin).toBe(true);
  expect((await a.from("profiles").select("is_admin").eq("id", ids[MEMBER]).single()).data?.is_admin).toBe(false);
  await m.context.close();
});

test("the last admin cannot give up their rights: the box rolls back with a message", async ({ browser }) => {
  // The shared stack has other admins (Mattéo, Khalifa), so the database
  // refusal is simulated with the exact error the guard trigger raises
  // (pgTAP 04_answers_profiles_teams covers the trigger itself).
  const a = await newPage(browser, ADMIN);
  await a.page.route("**/rest/v1/profiles?**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "42501", details: null, hint: null, message: "cannot remove the last admin" }),
    });
  });
  const mine = a.page.locator("tr.me").getByRole("checkbox", { name: fr.adminL });
  await expect(mine).toBeChecked();
  await mine.click();
  await expect(toast(a.page)).toHaveText(fr.lastAdmin);
  await expect(mine).toBeChecked();
  expect((await admin().from("profiles").select("is_admin").eq("id", ids[ADMIN]).single()).data?.is_admin).toBe(true);

  // Other refusals: RLS / guard → notAllowed, anything else → saveError.
  await a.page.unroute("**/rest/v1/profiles?**");
  await a.page.route("**/rest/v1/team_members?**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "42501", message: 'new row violates row-level security policy for table "team_members"' }),
        })
      : route.fallback(),
  );
  const ops = row(a.page, MEMBER).getByRole("checkbox", { name: fr.poles.ops });
  await ops.click();
  await expect(toast(a.page)).toHaveText(fr.notAllowed);
  await expect(ops).not.toBeChecked();
  await a.page.unroute("**/rest/v1/team_members?**");
  await a.page.route("**/rest/v1/team_members?**", (route) => route.abort());
  await ops.click();
  await expect(toast(a.page)).toHaveText(fr.saveError);
  await expect(ops).not.toBeChecked();
  expect((await admin().from("team_members").select("team").eq("user_id", ids[MEMBER])).data).toEqual([]);
  await a.context.close();
});

test("the display name is saved and persists; an empty name is refused", async ({ browser }) => {
  const m = await newPage(browser, MEMBER);
  const field = m.page.getByLabel(fr.profileNameL);
  await expect(field).toHaveValue("Tess Membre");

  await field.fill("  Tess   Martin ");
  await field.press("Enter");
  await expect(toast(m.page)).toHaveText(fr.profileSaved);
  await expect(field).toHaveValue("Tess Martin");
  await expect(m.page.locator("tr.me")).toContainText("Tess Martin");

  await m.page.reload();
  await expect(m.page.getByLabel(fr.profileNameL)).toHaveValue("Tess Martin");
  expect((await admin().from("profiles").select("full_name").eq("id", ids[MEMBER]).single()).data?.full_name).toBe(
    "Tess Martin",
  );

  // Saved when leaving the field too.
  await m.page.getByLabel(fr.profileNameL).fill("Tess Membre");
  await m.page.getByLabel(fr.profileNameL).press("Tab");
  await expect(toast(m.page)).toHaveText(fr.profileSaved);

  await m.page.getByLabel(fr.profileNameL).fill("   ");
  await m.page.getByLabel(fr.profileNameL).press("Enter");
  await expect(toast(m.page)).toHaveText(fr.nameRequired);
  await expect(m.page.getByLabel(fr.profileNameL)).toHaveAttribute("aria-invalid", "true");
  expect((await admin().from("profiles").select("full_name").eq("id", ids[MEMBER]).single()).data?.full_name).toBe(
    "Tess Membre",
  );
  // maxlength keeps it within the column's 120 characters.
  await expect(m.page.getByLabel(fr.profileNameL)).toHaveAttribute("maxlength", "120");
  await m.context.close();
});

test("works with the keyboard and fits a phone screen without page scroll", async ({ browser }) => {
  const a = await newPage(browser, ADMIN);
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.reload();
  const width = await a.page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  // Labels become visible chips on narrow screens.
  await expect(row(a.page, MEMBER).getByText(fr.poles.mini)).toBeVisible();

  const teamsOf = async () =>
    (await admin().from("team_members").select("team").eq("user_id", ids[MEMBER])).data?.map((r) => r.team);
  const crea = row(a.page, MEMBER).getByRole("checkbox", { name: fr.poles.crea });
  await crea.focus();
  await a.page.keyboard.press("Space");
  await expect(crea).toBeChecked();
  await expect.poll(teamsOf).toEqual(["crea"]);
  await a.page.keyboard.press("Space");
  await expect(crea).not.toBeChecked();
  await expect.poll(teamsOf).toEqual([]);
  await expect(toast(a.page)).toHaveText(fr.teamSaved);
  await a.context.close();
});
