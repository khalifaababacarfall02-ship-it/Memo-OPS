// End-to-end: why a save failed, said plainly (finding 4 of the review), and
// who may create a memo where (the memos insert policy: a non-admin writes
// only in their teams). Each refusal shows its own message, is not retried
// with the same text, and later edits are still saved. Users and data: `fe-err-`.
import { type Page, type Route, expect, test } from "@playwright/test";
import { cleanupUser, ensureUser, seedMemo, signIn } from "./support";
import { as, fr, fullContent, memoUrl, memosOf, row, saved, toast } from "./editor-support";

test.describe.configure({ mode: "serial" });

const AUTHOR = "fe-err-author@boxhero.test";
const DECIDER = "fe-err-decider@boxhero.test";
const NOTEAM = "fe-err-noteam@boxhero.test";
const ids: Record<string, string> = {};
const MEMOS = /\/rest\/v1\/memos\?/;

test.beforeAll(async () => {
  for (const e of [AUTHOR, DECIDER, NOTEAM]) await cleanupUser(e);
  ids.author = (await ensureUser(AUTHOR, { fullName: "Fe Err Author", teams: ["ops"], isAdmin: false })).id;
  ids.decider = (await ensureUser(DECIDER, { fullName: "Fe Err Decider", teams: ["ops"], isAdmin: false })).id;
  ids.noteam = (await ensureUser(NOTEAM, { fullName: "Fe Err NoTeam", teams: [], isAdmin: false })).id;
});
test.afterAll(async () => {
  for (const e of [AUTHOR, DECIDER, NOTEAM]) await cleanupUser(e);
});

/** Counts the PATCH requests to memos (saves of the document). */
function countPatches(page: Page) {
  const n = { patches: 0 };
  page.on("request", (r) => {
    if (r.method() === "PATCH" && MEMOS.test(r.url())) n.patches += 1;
  });
  return n;
}

test("too long: said before sending, not retried; a shorter text is saved. Limits on the title and answers", async ({
  browser,
}) => {
  const id = await seedMemo({ team: "ops", lang: "fr", title: "Long", author_id: ids.author, content: fullContent() });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  await expect(page.locator("#fTitle")).toHaveAttribute("maxlength", "300");
  await expect(page.locator("textarea.qa").first()).toHaveAttribute("maxlength", "20000");
  const n = countPatches(page);
  await page.locator('textarea[data-s="1"]').fill("x".repeat(260_000));
  await expect(page.locator("#saveState")).toHaveText(fr.tooLong);
  await expect(toast(page)).toHaveText(fr.tooLong);
  await page.waitForTimeout(2500);
  expect(n.patches).toBe(0);
  await page.locator('textarea[data-s="1"]').fill("Court");
  await saved(page);
  expect(((await row(id)).content as { s: string[] }).s[1]).toBe("Court");
  await page.context().close();
});

test("a memo to decide needs a title and a decision maker: said, not retried, fixed by the next edit", async ({ browser }) => {
  const id = await seedMemo({
    team: "ops",
    lang: "fr",
    title: "À décider",
    author_id: ids.author,
    decider_id: ids.decider,
    status: "to_decide",
    content: fullContent(),
  });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  // No empty choice for the decision maker while the memo is to decide.
  await expect(page.locator('#fDecider option[value=""]')).toHaveCount(0);
  const n = countPatches(page);
  await page.locator("#fTitle").fill("");
  await expect(page.locator("#saveState")).toHaveText(fr.needTitle);
  await expect(toast(page)).toHaveText(fr.needTitle);
  await page.waitForTimeout(3000);
  expect(n.patches).toBe(1);
  await page.locator("#fTitle").fill("Un nouveau titre");
  await saved(page);
  expect((await row(id)).title).toBe("Un nouveau titre");
  await page.context().close();
});

test("an expired session: says so, keeps the text on this device, restores it after signing in again", async ({ browser }) => {
  const id = await seedMemo({ team: "ops", lang: "fr", title: "Session", author_id: ids.author, content: fullContent() });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  const expired = (route: Route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "PGRST303", message: "JWT expired" }) })
      : route.continue();
  await page.route(MEMOS, expired);
  await page.locator('textarea[data-s="0"]').fill("Écrit hors session");
  await expect(page.locator("#saveState")).toHaveText(fr.sessionExpired);
  await expect(page.locator("#saveState a")).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/memos/${id}`)}`);
  await expect(toast(page)).toHaveText(fr.sessionExpired);
  expect(((await row(id)).content as { s: string[] }).s[0]).toBe("Pourquoi");

  // Signing in again (still refused here): the page renders the stored text, the draft is put back.
  await signIn(page, AUTHOR, `/memos/${id}`);
  await expect(page).toHaveURL(new RegExp(`/memos/${id}$`));
  await expect(page.locator('textarea[data-s="0"]')).toHaveValue("Écrit hors session");
  expect(((await row(id)).content as { s: string[] }).s[0]).toBe("Pourquoi");
  // The session works again: the next edit stores everything.
  await page.unroute(MEMOS);
  await page.locator('textarea[data-s="0"]').press("End");
  await page.keyboard.type(" !");
  await saved(page);
  expect(((await row(id)).content as { s: string[] }).s[0]).toBe("Écrit hors session !");
  await page.context().close();
});

test("the first save of a new memo refused (42501): 'not allowed', not 'check your connection'", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  const before = (await memosOf(ids.author)).length;
  const refuse = (route: Route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "42501", message: 'new row violates row-level security policy for table "memos"' }),
        })
      : route.continue();
  await page.route(MEMOS, refuse);
  await page.locator("#fTitle").fill("Interdit");
  await expect(toast(page)).toHaveText(fr.notAllowed);
  await expect(page.locator("#saveState")).toHaveText(fr.notAllowed);
  await expect(page).toHaveURL(/\/memos\/new\?team=ops$/);
  await page.waitForTimeout(2500); // not retried meanwhile
  expect(await memosOf(ids.author)).toHaveLength(before);
  await page.unroute(MEMOS);
  await page.locator("#fTitle").press("End");
  await page.keyboard.type("!");
  await expect(page).toHaveURL(memoUrl);
  await saved(page);
  expect((await memosOf(ids.author)).map((m) => m.title)).toContain("Interdit!");
  await page.context().close();
});

test("new memos only in the viewer's teams: other teams redirect or open the list; no team, no editor", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=finance&example=1");
  await expect(page).toHaveURL(/\/memos\/new\?team=ops&example=1$/);
  await expect(page.locator("#hTitle")).toContainText(fr.poles.ops);
  // A pill for a team the author is not in: that team's list, not a memo there.
  await page.locator('.poles button[data-p="finance"]').click();
  await expect(page).toHaveURL(/\/\?team=finance$/);
  await page.context().close();

  const lone = await as(browser, NOTEAM, "/memos/new?team=ops");
  await expect(lone.locator("#noTeam")).toHaveText(fr.noTeam);
  await expect(lone.locator("#fTitle")).toHaveCount(0);
  await expect(lone.locator(".nt-card a.btn")).toHaveAttribute("href", "/");
  await expect(lone).toHaveTitle(/^Le mémo Opérations/);
  await lone.context().close();
});
