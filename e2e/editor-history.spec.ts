// End-to-end: a new memo moves to /memos/<id> once stored (findings 1, 6, 7, 8
// of the review): Back/Forward show the real memo (never a blank one that
// would create a duplicate), a refresh while typing keeps the editor, the
// keystrokes and the caret, a reload right after typing never shows or saves
// older text, and lists are fresh after Back. Users and data: `fe-hist-`.
import { expect, test } from "@playwright/test";
import { cleanupUser, ensureUser, seedMemo } from "./support";
import { as, en, fr, fullContent, idFromUrl, memoUrl, memosOf, row, saved, stillTagged, tag } from "./editor-support";

test.describe.configure({ mode: "serial" });

const AUTHOR = "fe-hist-author@boxhero.test";
let authorId = "";

test.beforeAll(async () => {
  await cleanupUser(AUTHOR);
  authorId = (await ensureUser(AUTHOR, { fullName: "Fe Hist", teams: ["ops", "growth"], isAdmin: false })).id;
});
test.afterAll(async () => {
  await cleanupUser(AUTHOR);
});
test.beforeEach(async () => {
  await cleanupUser(AUTHOR);
});

test("a new memo moves to /memos/<id> keeping every keystroke and the caret; Back/Forward show the real memo", async ({
  browser,
}) => {
  const page = await as(browser, AUTHOR, "/", { waitSheet: false });
  // From the list, client-side: the list stays in the router cache for Back.
  await page.locator("#bNew").click();
  await expect(page).toHaveURL(/\/memos\/new\?team=ops$/);
  await page.locator("#fTitle").click();
  // Typed straight through the INSERT and the move to /memos/<id>.
  await page.keyboard.type("Mémo de l’historique", { delay: 25 });
  await expect(page).toHaveURL(memoUrl);
  await page.keyboard.type(" v2", { delay: 25 });
  await expect(page.locator("#fTitle")).toHaveValue("Mémo de l’historique v2");
  await expect(page.locator("#fTitle")).toBeFocused();
  expect(await page.locator("#fTitle").evaluate((el: HTMLInputElement) => el.selectionStart)).toBe("Mémo de l’historique v2".length);
  // The caret stays where it was: typing in the middle works too.
  await page.keyboard.press("Home");
  await page.keyboard.type("Le ");
  await saved(page);
  const id = idFromUrl(page);
  expect((await row(id)).title).toBe("Le Mémo de l’historique v2");

  // A team pill (stored memo) opens that team's list; Back shows the memo, not a blank one.
  await page.locator('.poles button[data-p="growth"]').click();
  await expect(page).toHaveURL(/\/\?team=growth$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/memos/${id}$`));
  await expect(page.locator("#fTitle")).toHaveValue("Le Mémo de l’historique v2");
  await expect(page.locator("#memoStatus")).toHaveText(fr.status.draft);

  // Back again: the list (restored from the router cache) is refreshed and lists the memo.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".lst-title", { hasText: "Le Mémo de l’historique v2" })).toBeVisible();

  // Forward: the real memo; typing updates it (no second memo).
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/memos/${id}$`));
  await expect(page.locator("#fTitle")).toHaveValue("Le Mémo de l’historique v2");
  await page.locator("#fTitle").press("End");
  await page.keyboard.type(" (suite)");
  await saved(page);
  const mine = await memosOf(authorId);
  expect(mine.map((m) => m.title)).toEqual(["Le Mémo de l’historique v2 (suite)"]);

  // Back from the edited memo: the list shows the new title.
  await page.goBack();
  await expect(page.locator(".lst-title", { hasText: "(suite)" })).toBeVisible();
  await page.context().close();
});

test("a refresh right after the memo is stored (FR/EN switch) keeps the editor, what is typed and the focus", async ({
  browser,
}) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  await page.locator("#fTitle").click();
  await page.keyboard.type("Langue", { delay: 20 });
  await expect(page).toHaveURL(memoUrl);
  await tag(page, "#fTitle");
  await page.locator('textarea[data-s="0"]').click();
  await tag(page, 'textarea[data-s="0"]');
  // Switch the language without moving the focus, and keep typing during the refresh.
  await page.evaluate(() => (document.querySelector('.lang button[data-l="en"]') as HTMLButtonElement).click());
  await page.keyboard.type("Typed during the switch", { delay: 30 });
  await expect(page.locator("#pTitle")).toContainText(en.steps);
  await page.keyboard.type(", and after.", { delay: 30 });
  await expect(page.locator('textarea[data-s="0"]')).toHaveValue("Typed during the switch, and after.");
  await expect(page.locator('textarea[data-s="0"]')).toBeFocused();
  expect(await stillTagged(page, "#fTitle")).toBe(true); // same editor: not remounted
  expect(await stillTagged(page, 'textarea[data-s="0"]')).toBe(true);
  await saved(page, en.savedAuto);
  const r = await row(idFromUrl(page));
  expect(r.title).toBe("Langue");
  expect((r.content as { s: string[] }).s[0]).toBe("Typed during the switch, and after.");

  // A switch before the first save ends (INSERT in flight) does not reset the new memo either.
  await page.goto("/memos/new?team=ops");
  await page.route(/\/rest\/v1\/memos\?/, async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.locator("#fTitle").click();
  await page.keyboard.type("Lent");
  await page.evaluate(() => (document.querySelector('.lang button[data-l="fr"]') as HTMLButtonElement).click());
  await page.keyboard.type(" mais gardé", { delay: 30 });
  await expect(page.locator("#pTitle")).toContainText(fr.steps);
  await expect(page).toHaveURL(memoUrl);
  await expect(page.locator("#fTitle")).toHaveValue("Lent mais gardé");
  await saved(page);
  expect((await row(idFromUrl(page))).title).toBe("Lent mais gardé");
  expect((await memosOf(authorId)).length).toBe(2);
  await page.context().close();
});

test("a reload right after typing shows the newest text and never saves older text over it", async ({ browser }) => {
  const id = await seedMemo({ team: "ops", lang: "fr", title: "Avant", author_id: authorId, content: fullContent() });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  // Hold the save so that the reload happens before it is stored.
  await page.route(/\/rest\/v1\/memos\?/, async (route) => {
    if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => {});
  });
  await page.locator("#fTitle").fill("Après le rechargement");
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator("#fTitle")).toHaveValue("Après le rechargement");
  await saved(page);
  expect((await row(id)).title).toBe("Après le rechargement");
  await page.unroute(/\/rest\/v1\/memos\?/);
  // Typing on: saved on top of the newest version.
  await page.locator("#fTitle").press("End");
  await page.keyboard.type(" !");
  await saved(page);
  expect((await row(id)).title).toBe("Après le rechargement !");
  await page.reload();
  await expect(page.locator("#fTitle")).toHaveValue("Après le rechargement !");
  await page.context().close();
});

test("a new-memo editor restored at a stored memo's URL never creates a memo: the real memo loads", async ({ browser }) => {
  const id = await seedMemo({ team: "ops", lang: "fr", title: "Le vrai mémo", author_id: authorId, content: fullContent() });
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  await expect(page.locator("#fTitle")).toHaveValue("");
  // What history.replaceState + Back used to produce: the /memos/new tree at /memos/<id>.
  await page.evaluate((memoId) => {
    window.history.replaceState(window.history.state, "", `/memos/${memoId}`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, id);
  await expect(page.locator("#fTitle")).toHaveValue("Le vrai mémo");
  await expect(page).toHaveURL(new RegExp(`/memos/${id}$`));
  await page.locator("#fTitle").press("End");
  await page.keyboard.type(" (édité)");
  await saved(page);
  expect((await memosOf(authorId)).map((m) => m.title)).toEqual(["Le vrai mémo (édité)"]);
  await page.context().close();
});
