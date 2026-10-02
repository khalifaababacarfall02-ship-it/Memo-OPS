// List view (/): who sees what, team pills, status tabs, search, rail panels,
// FR/EN, phone width. Data is seeded with the service role and tagged with a
// per-run token so other tests' memos in the shared database never interfere.
import { type Page, expect, test } from "@playwright/test";
import { teamColors } from "../src/lib/content";
import type { Json } from "../src/lib/database.types";
import { type TestUser, admin, cleanupUser, ensureUser, seedMemo, signIn } from "./support";

const TAG = `lsx${Date.now().toString(36)}`;
const EMAILS = {
  ops: "ls-ops@boxhero.test",
  growth: "ls-growth@boxhero.test",
  admin: "ls-admin@boxhero.test",
  lonely: "ls-lonely@boxhero.test",
};

let ops: TestUser;
let growth: TestUser;
const ids: Record<string, string> = {};

const memoContent = (why: string): Json => ({
  kind: "memo",
  author: "",
  meta: ["", "", "", ""],
  s: [why, "", "", ""],
  acts: [],
  needs: [],
  res: "",
  qs: [],
});
const miniContent = (what: string): Json => ({ kind: "mini", author: "", meta: ["", "", "", ""], s: [what, "", "", ""], works: "" });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ops = await ensureUser(EMAILS.ops, { fullName: "Léa Opérations", teams: ["ops"], isAdmin: false });
  growth = await ensureUser(EMAILS.growth, { fullName: "Gabin Growth", teams: ["growth"], isAdmin: false });
  await ensureUser(EMAILS.admin, { fullName: "Ada Admin", teams: [], isAdmin: true });
  await ensureUser(EMAILS.lonely, { fullName: "Solo Sans Pôle", teams: [], isAdmin: false });
  for (const email of Object.values(EMAILS)) await cleanupUser(email);

  // Inserted one by one: updated_at gives the order (latest first).
  const seed = async (key: string, row: Parameters<typeof seedMemo>[0]) => {
    ids[key] = await seedMemo(row);
  };
  await seed("m1", { team: "ops", lang: "fr", status: "draft", author_id: ops.id, title: `Œuvre${TAG} stock`, content: memoContent(`Seulement dans le contenu : zanzibar${TAG}`) });
  await seed("m2", { team: "ops", lang: "fr", status: "to_decide", author_id: growth.id, decider_id: ops.id, title: `Mémo${TAG} retours`, content: memoContent(TAG) });
  await seed("m3", { team: "ops", lang: "en", status: "decided", author_id: ops.id, decider_id: growth.id, title: `Décision${TAG} prix`, content: memoContent(TAG) });
  await seed("m4", { team: "ops", lang: "fr", status: "archived", author_id: ops.id, title: `Archivé${TAG} vieux`, content: memoContent(TAG) });
  await seed("m5", { team: "growth", lang: "fr", status: "draft", author_id: growth.id, title: `Growth${TAG} secret`, content: memoContent(TAG) });
  await seed("m6", { team: "growth", lang: "fr", status: "to_decide", author_id: growth.id, decider_id: ops.id, title: `Pub${TAG} test`, content: memoContent(TAG) });
  await seed("m7", { team: "growth", lang: "fr", status: "draft", author_id: ops.id, title: `Écrit par ops${TAG}`, content: memoContent(TAG) });
  await seed("m8", { team: "finance", lang: "fr", status: "decided", author_id: growth.id, title: `Finance${TAG} budget`, content: memoContent(TAG) });
  await seed("m9", { team: "mini", lang: "fr", status: "draft", author_id: growth.id, title: "", content: miniContent(`Concept ${TAG}`) });
  await seed("m10", { team: "ops", lang: "fr", status: "draft", author_id: growth.id, title: `Remise 50%${TAG}`, content: memoContent("") });
  await seed("m11", { team: "ops", lang: "fr", status: "draft", author_id: growth.id, title: `Remise 500${TAG}`, content: memoContent("") });
  await seed("m12", { team: "ops", lang: "fr", status: "draft", author_id: growth.id, title: `Code a_b${TAG}`, content: memoContent("") });
  await seed("m13", { team: "ops", lang: "fr", status: "draft", author_id: growth.id, title: `Code axb${TAG}`, content: memoContent("") });
});

test.afterAll(async () => {
  for (const email of Object.values(EMAILS)) await cleanupUser(email);
});

const rows = (page: Page) => page.locator(".lst .lst-row");
const rowIds = async (page: Page) =>
  (await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("href")))).map((h) => h!.replace("/memos/", ""));
const expectRows = async (page: Page, keys: string[]) => {
  await expect.poll(async () => (await rowIds(page)).sort()).toEqual(keys.map((k) => ids[k]).sort());
};
const visit = async (page: Page, query: Record<string, string>) => {
  await page.goto(`/?${new URLSearchParams(query)}`);
};

test("a team member sees their team's memos and the ones they write or decide", async ({ page }) => {
  await signIn(page, EMAILS.ops);
  await visit(page, { q: TAG });
  // ops memos (not archived), growth memos they decide or wrote; never growth's own, finance or mini.
  await expectRows(page, ["m1", "m2", "m3", "m6", "m7", "m10", "m11", "m12", "m13"]);
  await expect(page.locator(".lst-count")).toHaveText("9 mémos");

  // Latest first.
  expect((await rowIds(page))[0]).toBe(ids.m13);

  // Row content: title, team chip, status, author and decision maker, date.
  const row = rows(page).filter({ hasText: `Mémo${TAG}` });
  await expect(row).toHaveAttribute("href", `/memos/${ids.m2}`);
  await expect(row.locator(".lst-st")).toHaveText("À décider");
  await expect(row.locator(".lst-team")).toHaveText("Opérations");
  await expect(row).toContainText("par Gabin Growth · pour toi");
  await expect(row.locator(".lst-date")).toHaveText(/^Modifié le \d{1,2} \S+ à \d{2}:\d{2}$/);
  const draft = rows(page).filter({ hasText: `Remise 500${TAG}` });
  await expect(draft).toContainText("par Gabin Growth · décideur à choisir");
  await expect(draft).not.toContainText("pour");
  await expect(draft.locator(".lst-st")).toHaveText("Brouillon");
});

test("another team member sees their own set", async ({ page }) => {
  await signIn(page, EMAILS.growth);
  await visit(page, { q: TAG });
  await expectRows(page, ["m2", "m3", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13"]);
  // The untitled mini memo.
  await expect(rows(page).filter({ has: page.locator(".lst-team", { hasText: "Mini-mémo pub" }) })).toContainText("Sans titre");
});

test("an admin sees everything", async ({ page }) => {
  await signIn(page, EMAILS.admin);
  await visit(page, { q: TAG });
  await expectRows(page, ["m1", "m2", "m3", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13"]);
  await visit(page, { q: TAG, status: "archived" });
  await expectRows(page, ["m4"]);
  // No team: the new memo opens in Operations; no "not in a team" note for admins.
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=ops");
  await expect(page.locator(".lst-note")).toHaveCount(0);
  // Admins write in any team: the filtered one.
  await visit(page, { team: "finance" });
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=finance");
  await expect(page.locator("#bExample")).toHaveAttribute("href", "/memos/new?team=finance&example=1");
});

test("team pills filter and keep the status and the search", async ({ page }) => {
  await signIn(page, EMAILS.ops);
  await visit(page, { q: TAG, status: "to_decide" });
  await expectRows(page, ["m2", "m6"]);
  await expect(page.locator(".poles button[data-p=all]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hTitle")).toHaveText(/Les mémos\s*Tous les pôles/i);

  await page.locator(".poles button[data-p=growth]").click();
  await expect(page).toHaveURL(`/?team=growth&status=to_decide&q=${TAG}`);
  await expectRows(page, ["m6"]);
  await expect(page.locator(".poles button[data-p=growth]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hTitle")).toHaveText(/Les mémos\s*Growth/i);
  // The page takes the team's colours.
  const acc = () => page.evaluate(() => getComputedStyle(document.querySelector(".app")!).getPropertyValue("--acc").trim());
  await expect.poll(acc).toBe(teamColors("growth").acc);
  // New memo / example open in a team they can write in: not Growth (not a member), their own.
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=ops");
  await expect(page.locator("#bExample")).toHaveAttribute("href", "/memos/new?team=ops&example=1");
  await page.locator(".poles button[data-p=ops]").click();
  await expect(page).toHaveURL(`/?team=ops&status=to_decide&q=${TAG}`);
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=ops");

  await page.locator(".poles button[data-p=all]").click();
  await expect(page).toHaveURL(`/?status=to_decide&q=${TAG}`);
  await expectRows(page, ["m2", "m6"]);
});

test("status tabs: the default hides archived memos", async ({ page }) => {
  await signIn(page, EMAILS.ops);
  await visit(page, { q: TAG });
  const tabs = page.locator(".lst-tabs a");
  await expect(tabs).toHaveText(["Tous", "Brouillon", "À décider", "Décidé", "Archivé"]);
  await expect(tabs.first()).toHaveAttribute("aria-current", "page");

  await tabs.filter({ hasText: "Archivé" }).click();
  await expect(page).toHaveURL(`/?status=archived&q=${TAG}`);
  await expectRows(page, ["m4"]);
  await expect(page.locator(".lst-count")).toHaveText("1 mémo");
  await expect(tabs.filter({ hasText: "Archivé" })).toHaveAttribute("aria-current", "page");

  await tabs.filter({ hasText: "Décidé" }).click();
  await expectRows(page, ["m3"]);
  await tabs.filter({ hasText: "Brouillon" }).click();
  await expectRows(page, ["m1", "m7", "m10", "m11", "m12", "m13"]);
  await tabs.filter({ hasText: "Tous" }).click();
  await expect(page).toHaveURL(`/?q=${TAG}`);
  await expectRows(page, ["m1", "m2", "m3", "m6", "m7", "m10", "m11", "m12", "m13"]);

  // Invalid values are ignored.
  await visit(page, { q: TAG, status: "deleted", team: "marketing" });
  await expectRows(page, ["m1", "m2", "m3", "m6", "m7", "m10", "m11", "m12", "m13"]);
});

test("search: title words, content words, accents, ligatures, literal wildcards", async ({ page }) => {
  await signIn(page, EMAILS.ops);
  await visit(page, {});
  const field = page.getByRole("searchbox", { name: "Chercher" });
  await expect(field).toHaveAttribute("placeholder", "Un titre, un mot, un nom…");

  // Typing updates the URL after a pause and keeps the focus.
  await field.click();
  await field.pressSequentially(`decision${TAG}`, { delay: 20 });
  await expect(page).toHaveURL(`/?q=decision${TAG}`);
  await expectRows(page, ["m3"]);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(`decision${TAG}`);

  const search = async (q: string, keys: string[]) => {
    await field.fill(q);
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(q.trim());
    await expectRows(page, keys);
  };
  await search(`memo${TAG}`, ["m2"]); // "Mémo…" in the title
  await search(`MÉMO${TAG} RETOURS`, ["m2"]);
  await search(`oeuvre${TAG}`, ["m1"]); // "Œuvre…"
  await search(`zanzibar${TAG}`, ["m1"]); // only in the content
  await search(`50%${TAG}`, ["m10"]); // not "500…"
  await search(`a_b${TAG}`, ["m12"]); // not "axb…"
  await search(`ecrit par ops${TAG}`, ["m7"]);

  // PostgREST's reserved characters are plain text: no error, nothing found, and the list says so.
  await search(`(x),y.z:${TAG}`, []);
  await expect(page.locator(".lst-empty")).toHaveText(`Aucun mémo ne correspond à « (x),y.z:${TAG} ».`);
  await expect(page.locator(".lst-count")).toHaveText("0 mémo");

  // Enter searches at once; clearing the field shows everything again.
  await field.fill(`prix`);
  await field.press("Enter");
  await expect(page).toHaveURL("/?q=prix");
  await field.fill("");
  await expect(page).toHaveURL("/");
});

test("search works without JavaScript (GET form)", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await context.newPage();
  await signIn(page, EMAILS.ops);
  await visit(page, { team: "ops", status: "decided" });
  const field = page.getByRole("searchbox", { name: "Chercher" });
  await field.fill(`décision${TAG}`);
  await field.press("Enter");
  await expect(page).toHaveURL(new RegExp(`team=ops`));
  expect(new URL(page.url()).searchParams.get("q")).toBe(`décision${TAG}`);
  expect(new URL(page.url()).searchParams.get("status")).toBe("decided");
  await expectRows(page, ["m3"]);
  await context.close();
});

test("rail: waiting for my decision, my memos, new memo links", async ({ page }) => {
  await signIn(page, EMAILS.ops);
  await visit(page, {});
  const forMe = page.locator("#forMe");
  await expect(forMe.locator("h3")).toHaveText("À décider par moi");
  await expect(forMe.locator("a.open")).toHaveCount(2);
  await expect(forMe.locator("a.open b")).toHaveText([`Pub${TAG} test`, `Mémo${TAG} retours`]);
  await expect(forMe.locator("a.open").first()).toHaveAttribute("href", `/memos/${ids.m6}`);
  await expect(forMe.locator("a.open span").first()).toHaveText(/^\d{1,2} \S+ à \d{2}:\d{2}$/);

  const mine = page.locator("#mine");
  await expect(mine.locator("h3")).toHaveText("Mes mémos");
  // Not archived, latest first.
  await expect(mine.locator("a.open b")).toHaveText([`Écrit par ops${TAG}`, `Décision${TAG} prix`, `Œuvre${TAG} stock`]);

  await expect(page.locator("#bNew")).toHaveText("Nouveau mémo");
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=ops");
  await expect(page.locator("#bExample")).toHaveText("Voir un mémo rempli");
  await expect(page.locator("#bExample")).toHaveAttribute("href", "/memos/new?team=ops&example=1");

  // The growth member's new memo goes to Growth.
  await signIn(page, EMAILS.growth);
  await visit(page, {});
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=growth");
  await expect(page.locator("#forMe")).toContainText("Rien à décider pour l’instant.");
});

test("someone in no team: empty list, explanation, empty rail, no new memo", async ({ page }) => {
  await signIn(page, EMAILS.lonely);
  await visit(page, { q: TAG });
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(".lst-count")).toHaveText("0 mémo");
  await expect(page.locator(".lst-empty")).toHaveText(`Aucun mémo ne correspond à « ${TAG} ».`);
  await expect(page.locator(".lst-note")).toContainText("Tu n’es encore dans aucun pôle");
  await expect(page.locator("#forMe")).toContainText("Rien à décider pour l’instant.");
  await expect(page.locator("#mine")).toContainText("Pas encore de mémo.");
  // They can write in no team: no "New memo" (the database would refuse it).
  await expect(page.locator("#bNew")).toHaveCount(0);
  await expect(page.locator("#bExample")).toHaveCount(0);
  await visit(page, { team: "ops" });
  await expect(page.locator("#bNew")).toHaveCount(0);
  // Without a search: the empty list, without the hint about the missing button.
  await visit(page, {});
  await expect(page.locator(".lst-empty")).toHaveText("Aucun mémo ici pour l’instant.");
});

test("FR/EN switch", async ({ page }) => {
  await signIn(page, EMAILS.ops);
  await visit(page, { q: TAG, team: "ops" });
  await page.locator(".lang button[data-l=en]").click();
  await expect(page.locator("#hTitle")).toHaveText(/The memos\s*Operations/i);
  await expect(page.locator(".lst-tabs a")).toHaveText(["All", "Draft", "To decide", "Decided", "Archived"]);
  await expect(page.locator(".lst-count")).toHaveText("7 memos");
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue(TAG);
  await expect(rows(page).filter({ hasText: `Mémo${TAG}` })).toContainText("by Gabin Growth · for you");
  await expect(rows(page).filter({ hasText: `Mémo${TAG}` }).locator(".lst-date")).toHaveText(/^Updated \d{1,2} \S+ at \d{2}:\d{2}$/);
  await expect(page.locator("#forMe h3")).toHaveText("Waiting for my decision");
  await expect(rows(page).filter({ hasText: `Remise 500${TAG}` })).toContainText("by Gabin Growth · decision maker to be chosen");
  await visit(page, { q: `nothing${TAG}`, team: "ops" });
  await expect(page.locator(".lst-count")).toHaveText("0 memos");
  await expect(page.locator(".lst-empty")).toHaveText(`No memo matches "nothing${TAG}".`);
  await page.locator(".lang button[data-l=fr]").click();
  await expect(page.locator("#hTitle")).toHaveText(/Les mémos\s*Opérations/i);
});

test("phone width: no horizontal scroll", async ({ page }) => {
  // Long titles (one of them unbreakable) in the list and in the rail.
  ids.long1 = await seedMemo({
    team: "ops", lang: "fr", status: "draft", author_id: ops.id, content: memoContent(TAG),
    title: `Réétiqueter tout le stock 1.0 chez Flatfee avec une remise sur les tailles trop grandes ${TAG}`,
  });
  ids.long2 = await seedMemo({
    team: "ops", lang: "fr", status: "to_decide", author_id: growth.id, decider_id: ops.id, content: memoContent(TAG),
    title: `Unbreakable${"x".repeat(80)}${TAG}`,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, EMAILS.ops);
  await visit(page, { q: TAG });
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator("#mine a.open").first()).toContainText("Réétiqueter tout le stock");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("unknown pages: the app's 404 with the way back", async ({ page }) => {
  await signIn(page, EMAILS.ops);
  const res = await page.goto("/nothing/here");
  expect(res?.status()).toBe(404);
  await expect(page.locator(".solo-card h2")).toHaveText("404");
  // Not about a memo: any URL.
  await expect(page.locator(".solo-card .intro")).toHaveText("Cette page n’existe pas.");
  await expect(page).toHaveTitle(/^Cette page n’existe pas( · Mémo BoxHero)?$/);
  await expect(page.locator(".acct button")).toHaveText("Se déconnecter");
  await page.locator(".lang button[data-l=en]").click();
  await expect(page.locator(".solo-card .intro")).toHaveText("This page doesn’t exist.");
  await page.getByRole("link", { name: "Back to memos" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("#hTitle")).toHaveText(/The memos/i);
});

test("seeded rows are only test data", async () => {
  // Guard against a typo seeding into someone else's account.
  const { data } = await admin().from("memos").select("author_id").ilike("title", `%${TAG}%`);
  for (const r of data ?? []) expect([ops.id, growth.id]).toContain(r.author_id);
});
