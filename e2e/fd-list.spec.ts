// Regressions from the review of the list view: the search pause no longer
// undoes a tab or pill click, long lists page with "Show more", the list is
// fresh after browser Back, list styles stay on the list, page titles, and the
// "New memo" team. Users and rows use the fd- prefix and a per-run tag.
import { type Page, expect, test } from "@playwright/test";
import type { Json } from "../src/lib/database.types";
import { type TestUser, admin, cleanupUser, ensureUser, seedMemo, signIn } from "./support";

const TAG = `fdl${Date.now().toString(36)}`;
const EMAILS = {
  author: "fd-list-author@boxhero.test",
  admin: "fd-list-admin@boxhero.test",
};

let author: TestUser;
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

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  author = await ensureUser(EMAILS.author, { fullName: "Fanny Liste", teams: ["ops"], isAdmin: false });
  await ensureUser(EMAILS.admin, { fullName: "Fabien Admin", teams: [], isAdmin: true });
  for (const email of Object.values(EMAILS)) await cleanupUser(email);
  ids.draft = await seedMemo({ team: "ops", lang: "fr", status: "draft", author_id: author.id, title: `Brouillon ${TAG}`, content: memoContent(TAG) });
  ids.decided = await seedMemo({ team: "ops", lang: "fr", status: "decided", author_id: author.id, decider_id: author.id, title: `Décidé ${TAG}`, content: memoContent(TAG) });
  ids.archived = await seedMemo({ team: "ops", lang: "fr", status: "archived", author_id: author.id, title: `Archivé ${TAG}`, content: memoContent(TAG) });
  ids.growth = await seedMemo({ team: "growth", lang: "fr", status: "draft", author_id: author.id, title: `Growth ${TAG}`, content: memoContent(TAG) });
});

test.afterAll(async () => {
  for (const email of Object.values(EMAILS)) await cleanupUser(email);
});

const rowTitles = (page: Page) => page.locator(".lst .lst-title").allInnerTexts();

test("a tab clicked during the search pause wins, and keeps what was typed", async ({ page }) => {
  await signIn(page, EMAILS.author);
  await expect(page).toHaveURL("/");
  const field = page.getByRole("searchbox", { name: "Chercher" });
  await field.click();
  // Typed, then a tab right away (within the 300 ms pause).
  await field.pressSequentially(TAG, { delay: 10 });
  await page.locator('.lst-tabs a[data-status="draft"]').click();
  await expect(page).toHaveURL(`/?status=draft&q=${TAG}`);
  // The delayed search must not take the page back to "All" afterwards.
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(`/?status=draft&q=${TAG}`);
  await expect(page.locator('.lst-tabs a[aria-current="page"]')).toHaveText("Brouillon");
  await expect(field).toHaveValue(TAG);
  expect((await rowTitles(page)).sort()).toEqual([`Brouillon ${TAG}`, `Growth ${TAG}`]);
});

test("a team pill clicked during the search pause wins too", async ({ page }) => {
  await signIn(page, EMAILS.author);
  await page.goto("/?status=draft");
  const field = page.getByRole("searchbox", { name: "Chercher" });
  await field.click();
  await field.pressSequentially(TAG, { delay: 10 });
  await page.locator(".poles button[data-p=growth]").click();
  await expect(page).toHaveURL(`/?team=growth&status=draft&q=${TAG}`);
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(`/?team=growth&status=draft&q=${TAG}`);
  await expect(page.locator(".poles button[data-p=growth]")).toHaveAttribute("aria-pressed", "true");
  expect(await rowTitles(page)).toEqual([`Growth ${TAG}`]);

  // Back right after typing: the history entry wins, the typing is dropped.
  await field.fill(`${TAG}x`);
  await page.goBack();
  await expect(page).toHaveURL("/?status=draft");
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL("/?status=draft");
});

test("the list is fresh after browser Back from the editor", async ({ page }) => {
  await signIn(page, EMAILS.author);
  await page.goto(`/?q=${TAG}`);
  const renamed = `Renommé ${TAG}`;
  await expect(page.locator("#mine a.open b").first()).toBeVisible();
  // Open the draft from the list (client-side navigation), rename it.
  await page.locator(`.lst a.lst-row[href="/memos/${ids.draft}"]`).click();
  await expect(page).toHaveURL(`/memos/${ids.draft}`);
  await page.locator("#fTitle").fill(renamed);
  await expect
    .poll(async () => (await admin().from("memos").select("title").eq("id", ids.draft).single()).data?.title)
    .toBe(renamed);

  await page.goBack();
  await expect(page).toHaveURL(`/?q=${TAG}`);
  await expect(page.locator(`.lst a.lst-row[href="/memos/${ids.draft}"] .lst-title`)).toHaveText(renamed);
  await expect(page.locator(`#mine a.open[href="/memos/${ids.draft}"] b`)).toHaveText(renamed);
  // Forward and Back again: still fresh, the search kept.
  await page.goForward();
  await expect(page).toHaveURL(`/memos/${ids.draft}`);
  await page.goBack();
  await expect(page.locator(`.lst a.lst-row[href="/memos/${ids.draft}"] .lst-title`)).toHaveText(renamed);
  await expect(page.getByRole("searchbox", { name: "Chercher" })).toHaveValue(TAG);
});

test("list status styles stay on the list (the editor's badge after a client-side navigation)", async ({ page }) => {
  await signIn(page, EMAILS.author);
  await page.goto(`/?status=archived&q=${TAG}`);
  const listBadge = page.locator(`.lst a.lst-row[href="/memos/${ids.archived}"] .lst-st`);
  await expect(listBadge).toHaveCSS("border-top-style", "dashed");
  await page.locator(`.lst a.lst-row[href="/memos/${ids.archived}"]`).click();
  await expect(page).toHaveURL(`/memos/${ids.archived}`);
  const badge = page.locator("#memoStatus");
  await expect(badge).toBeVisible();
  // The editor badge now uses the list's palette on purpose (dashed 1 px for archived);
  // what must not leak is the list's own row styling (3 px).
  await expect(badge).toHaveCSS("border-top-style", "dashed");
  await expect(badge).toHaveCSS("border-top-width", "1px");
});

test("long lists: 200 rows, then 'Show more' adds the next ones, filters kept", async ({ page }) => {
  const many = `${TAG}many`;
  // One insert (service role, which keeps the given updated_at): row i is i minutes newer.
  const rows = Array.from({ length: 205 }, (_, i) => ({
    team: "ops" as const,
    lang: "fr" as const,
    status: "draft" as const,
    author_id: author.id,
    title: `${many} ${String(i).padStart(3, "0")}`,
    updated_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  }));
  const { error } = await admin().from("memos").insert(rows);
  expect(error).toBeNull();

  await signIn(page, EMAILS.author);
  await page.goto(`/?team=ops&q=${many}`);
  await expect(page.locator(".lst-count")).toHaveText("205 mémos");
  await expect(page.locator(".lst .lst-row")).toHaveCount(200);
  const more = page.getByRole("link", { name: "Afficher plus" });
  await expect(more).toHaveAttribute("href", `/?team=ops&q=${many}&limit=400`);
  await more.click();
  await expect(page).toHaveURL(`/?team=ops&q=${many}&limit=400`);
  await expect(page.locator(".lst .lst-row")).toHaveCount(205);
  await expect(more).toHaveCount(0);
  // Latest first, the oldest last: no row twice, none missing.
  const titles = await rowTitles(page);
  expect(new Set(titles).size).toBe(205);
  expect(titles[0]).toBe(`${many} 204`);
  expect(titles.at(-1)).toBe(`${many} 000`);

  // A tab goes back to the first page; English label.
  await page.locator('.lst-tabs a[data-status="draft"]').click();
  await expect(page).toHaveURL(`/?team=ops&status=draft&q=${many}`);
  await expect(page.locator(".lst .lst-row")).toHaveCount(200);
  await page.locator(".lang button[data-l=en]").click();
  await expect(page.getByRole("link", { name: "Show more" })).toBeVisible();
  await page.locator(".lang button[data-l=fr]").click();
  await expect(page.getByRole("link", { name: "Afficher plus" })).toBeVisible();

  // Under the limit: no link.
  await page.goto(`/?q=${many}%2000`);
  await expect(page.locator(".lst .lst-row")).toHaveCount(10);
  await expect(page.getByRole("link", { name: "Afficher plus" })).toHaveCount(0);
  await admin().from("memos").delete().like("title", `${many} %`).eq("author_id", author.id);
});

test("'New memo' opens a team the visitor can write in", async ({ page }) => {
  await signIn(page, EMAILS.author);
  // Member of ops only: a Growth filter still creates in Operations.
  await page.goto("/?team=growth");
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=ops");
  await page.goto("/?team=ops");
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=ops");
  await signIn(page, EMAILS.admin);
  await page.goto("/?team=mini");
  await expect(page.locator("#bNew")).toHaveAttribute("href", "/memos/new?team=mini");
  await expect(page.locator("#bExample")).toHaveAttribute("href", "/memos/new?team=mini&example=1");
});

test("each page has its own title", async ({ page }) => {
  const suffix = "( · Mémo BoxHero)?$";
  await signIn(page, EMAILS.author);
  await page.goto("/");
  await expect(page).toHaveTitle(new RegExp(`^Les mémos${suffix}`));
  await page.goto("/?team=growth&status=draft");
  await expect(page).toHaveTitle(new RegExp(`^Growth${suffix}`));
  await page.goto("/?team=sav");
  await expect(page).toHaveTitle(new RegExp(`^SAV${suffix}`));
  await page.goto("/team");
  await expect(page).toHaveTitle(new RegExp(`^L’équipe${suffix}`));
  await page.goto("/nope");
  await expect(page).toHaveTitle(new RegExp(`^Cette page n’existe pas${suffix}`));
  await page.locator(".lang button[data-l=en]").click();
  await expect(page).toHaveTitle(new RegExp(`^This page doesn’t exist${suffix}`));
  await page.goto("/");
  await expect(page).toHaveTitle(new RegExp(`^The memos${suffix}`));
  await page.locator(".lang button[data-l=fr]").click();
  await expect(page).toHaveTitle(new RegExp(`^Les mémos${suffix}`));
});

test("a memo that does not exist: the same 404 card as any unknown page, with the memo message", async ({ page }) => {
  await signIn(page, EMAILS.author);
  const res = await page.goto("/memos/00000000-0000-4000-8000-000000000000");
  expect(res?.status()).toBe(404);
  await expect(page.locator(".wrap.solo .solo-card h2")).toHaveText("404");
  await expect(page.locator(".solo-card .intro")).toHaveText("Ce mémo n’existe pas, ou tu n’y as pas accès.");
  await expect(page.locator(".solo-card a.btn")).toHaveAttribute("href", "/");
  // Same layout as the generic 404: one centred card, no rail.
  const memoBox = await page.locator(".solo-card").boundingBox();
  await page.goto("/nothing/here");
  const pageBox = await page.locator(".solo-card").boundingBox();
  expect(memoBox).toEqual(pageBox);
  await expect(page.locator(".rail")).toHaveCount(0);
});

test("no stylesheet is preloaded for nothing (console)", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" && m.text().includes("preloaded")) warnings.push(m.text());
  });
  await signIn(page, EMAILS.author);
  for (const path of ["/", "/team", "/nope"]) {
    await page.goto(path);
    // Chrome reports an unused preload a few seconds after the load event.
    await page.waitForTimeout(3500);
  }
  expect(warnings.filter((w) => w.includes(".css"))).toEqual([]);
});
