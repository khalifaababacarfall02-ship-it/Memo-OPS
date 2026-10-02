// End-to-end: the memo editor (/memos/new, /memos/[id]) against a real
// Supabase. Users and data use the `ed-` prefix and are removed at the end.
import { type Browser, type Page, expect, test } from "@playwright/test";
import { doc, ui } from "../src/lib/content";
import { asanaHTML, htmlToText, pdfFileName } from "../src/lib/memo/export";
import { type MemoContent, normalizeContent } from "../src/lib/memo/model";
import { admin, cleanupUser, ensureUser, seedMemo, signIn } from "./support";

test.describe.configure({ mode: "serial" });
// Chromium on Linux names a download "download" when the locale cannot encode
// the file name (e.g. LANG=C and "Memo_Décider….pdf"): run it with UTF-8.
test.use({ launchOptions: { env: { ...process.env, LANG: "C.UTF-8" } } });

const fr = ui("fr");
const en = ui("en");
// E2E_USER_PREFIX lets parallel runs on a shared stack use their own users.
const P = process.env.E2E_USER_PREFIX ?? "ed-";
const AUTHOR = `${P}author@boxhero.test`;
const DECIDER = `${P}decider@boxhero.test`;
const READER = `${P}reader@boxhero.test`;
const OUTSIDER = `${P}outsider@boxhero.test`;
const ADMIN = `${P}admin@boxhero.test`;
const EMAILS = [AUTHOR, DECIDER, READER, OUTSIDER, ADMIN];

const ids: Record<string, string> = {};

test.beforeAll(async () => {
  for (const e of EMAILS) await cleanupUser(e);
  // A non-admin creates memos only in their teams (memos insert policy).
  ids.author = (await ensureUser(AUTHOR, { fullName: "Ed Author", teams: ["ops", "growth", "crea", "mini"], isAdmin: false })).id;
  ids.decider = (await ensureUser(DECIDER, { fullName: "Ed Decider", teams: ["growth"], isAdmin: false })).id;
  ids.reader = (await ensureUser(READER, { fullName: "Ed Reader", teams: ["ops"], isAdmin: false })).id;
  ids.outsider = (await ensureUser(OUTSIDER, { fullName: "Ed Outsider", teams: ["finance"], isAdmin: false })).id;
  ids.admin = (await ensureUser(ADMIN, { fullName: "Ed Admin", teams: [], isAdmin: true })).id;
});

test.afterAll(async () => {
  for (const e of EMAILS) await cleanupUser(e);
  await admin().from("profiles").update({ is_admin: false }).eq("id", ids.admin);
});

/** A signed-in page for `email` in its own browser context. */
async function as(browser: Browser, email: string, path: string, opts: { lang?: "fr" | "en"; clipboard?: boolean } = {}) {
  const baseURL = test.info().project.use.baseURL!;
  const ctx = await browser.newContext({
    baseURL,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    permissions: opts.clipboard ? ["clipboard-read", "clipboard-write"] : [],
  });
  await ctx.addCookies([{ name: "bxh-lang", value: opts.lang ?? "fr", url: baseURL }]);
  const page = await ctx.newPage();
  await signIn(page, email, path);
  await page.waitForURL((u) => u.pathname === path.split("?")[0] || u.pathname.startsWith("/memos/"));
  await expect(page.locator("#sheet")).toBeVisible();
  return page;
}

const memoUrl = /\/memos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const idFromUrl = (page: Page) => page.url().split("/").pop()!;
const toast = (page: Page) => page.locator(".toast.show");

/** Wait until the autosave says everything is stored. */
async function saved(page: Page, label = fr.savedAuto) {
  await expect(page.locator("#saveState")).toHaveText(label, { timeout: 10_000 });
}

async function row(id: string) {
  const { data, error } = await admin().from("memos").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function countAuthored(userId: string) {
  const { count } = await admin().from("memos").select("id", { count: "exact", head: true }).eq("author_id", userId);
  return count ?? 0;
}

// ---------------------------------------------------------------------------

test("a new memo is stored only after the first edit, then lives at /memos/<id>", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  await expect(page).toHaveURL(/\/memos\/new\?team=ops$/);
  // Author prefilled with the viewer's name; nothing stored yet.
  await expect(page.locator("#fAuthor")).toHaveValue("Ed Author");
  await expect(page.locator("#memos li.cur b")).toHaveText(fr.untitled);
  await page.locator("#showEx").uncheck();
  await page.locator("#showEx").check();
  await page.waitForTimeout(1000);
  expect(await countAuthored(ids.author)).toBe(0);

  // Team pills switch an untouched memo in place (in the author's teams); the pressed pill keeps the focus.
  await page.locator('.poles button[data-p="growth"]').click();
  await expect(page).toHaveURL(/\/memos\/new\?team=growth$/);
  await expect(page.locator("#hTitle")).toContainText("Growth");
  await expect(page.locator('.poles button[data-p="growth"]')).toBeFocused();
  await page.locator('.poles button[data-p="ops"]').click();
  await expect(page).toHaveURL(/\/memos\/new\?team=ops$/);
  await expect(page.locator('.poles button[data-p="ops"]')).toBeFocused();
  expect(await countAuthored(ids.author)).toBe(0);

  // First keystrokes: one INSERT, then the editor moves to /memos/<id> (focus and caret kept).
  await page.locator("#fTitle").click();
  await page.keyboard.type("Corriger les retours", { delay: 15 });
  await expect(page).toHaveURL(memoUrl);
  await page.keyboard.type(" Amazon", { delay: 15 });
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("fTitle");
  await saved(page);
  await expect(page.locator("#fTitle")).toHaveValue("Corriger les retours Amazon");
  expect(await countAuthored(ids.author)).toBe(1);

  const id = idFromUrl(page);
  const r = await row(id);
  expect(r).toMatchObject({ team: "ops", lang: "fr", title: "Corriger les retours Amazon", status: "draft", author_id: ids.author });
  await expect(page.locator("#memos li.cur b")).toHaveText("Corriger les retours Amazon");

  await page.reload();
  await expect(page.locator("#fTitle")).toHaveValue("Corriger les retours Amazon");
  // Tab title: the memo's title (the root layout's template adds the app name).
  await expect(page).toHaveTitle(/^Corriger les retours Amazon/);
  await page.context().close();
});

test("autosave of header, sections, actions, requests and questions; progress steps", async ({ browser }) => {
  const id = await seedMemo({ team: "ops", lang: "fr", title: "Autosave", author_id: ids.author, content: {} });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  const steps = page.locator("#steps li");
  await expect(steps).toHaveCount(5);
  await expect(page.locator("#steps li.done")).toHaveCount(0);
  await expect(steps.first()).toHaveText("Pourquoi");

  for (let i = 0; i < 4; i++) await page.locator(`[data-m="${i}"]`).fill(`meta ${i}`);
  await page.locator("#fAuthor").fill("Khalifa");
  await page.locator('textarea[data-s="0"]').fill("Pourquoi maintenant\nsur deux lignes");
  await expect(page.locator("#steps li.done")).toHaveCount(1);
  await page.locator('textarea[data-s="1"]').fill("Le problème");
  await page.locator('textarea[data-s="2"]').fill("Les étapes");
  await page.locator('textarea[data-s="3"]').fill("Je propose");
  await expect(page.locator("#steps li.done")).toHaveCount(4);
  await page.locator('textarea[data-f="res"]').fill("Retours sous 12 %");

  // Normalised empty content: no rows yet. Add, fill and remove rows.
  await page.locator("#addAct").click();
  await page.locator("#addAct").click();
  await expect(page.locator("#acts .row")).toHaveCount(2);
  await page.locator('[data-a="0:0"]').fill("Première étape");
  await page.locator('[data-a="0:1"]').fill("Lukas");
  await page.locator('[data-a="0:2"]').fill("2 octobre");
  await page.locator('[data-a="1:0"]').fill("À supprimer");
  await page.locator('#acts [data-da="1"]').click();
  await expect(page.locator("#acts .row")).toHaveCount(1);

  await page.locator("#addNeed").click();
  await page.locator("#addNeed").click();
  await page.locator('[data-nt="0"]').fill("Ton accord");
  await page.locator('[data-nc="0"]').check();
  await page.locator('#needs [data-dn="1"]').click();
  await expect(page.locator("#needs .need")).toHaveCount(1);

  await page.locator("#addQ").click();
  await page.locator("#addQ").click();
  await page.locator('[data-q="0:0"]').fill("On réétiquette ?");
  await expect(page.locator("#steps li.done")).toHaveCount(5);
  await page.locator('#qs [data-dq="1"]').click();
  await expect(page.locator("#qs .qrow")).toHaveCount(1);
  await saved(page);

  const c = normalizeContent("ops", (await row(id)).content) as Extract<MemoContent, { kind: "memo" }>;
  expect(c.meta).toEqual(["meta 0", "meta 1", "meta 2", "meta 3"]);
  expect(c.author).toBe("Khalifa");
  expect(c.s).toEqual(["Pourquoi maintenant\nsur deux lignes", "Le problème", "Les étapes", "Je propose"]);
  expect(c.res).toBe("Retours sous 12 %");
  expect(c.acts.map(({ action, owner, due }) => [action, owner, due])).toEqual([["Première étape", "Lukas", "2 octobre"]]);
  expect(c.needs.map(({ done, text }) => [done, text])).toEqual([[true, "Ton accord"]]);
  expect(c.qs.map((q) => q.q)).toEqual(["On réétiquette ?"]);
  const qid = c.qs[0].id;

  await page.reload();
  await expect(page.locator('textarea[data-s="0"]')).toHaveValue("Pourquoi maintenant\nsur deux lignes");
  await expect(page.locator('[data-a="0:1"]')).toHaveValue("Lukas");
  await expect(page.locator('[data-nc="0"]')).toBeChecked();
  await expect(page.locator('[data-q="0:0"]')).toHaveValue("On réétiquette ?");
  await expect(page.locator("#steps li.done")).toHaveCount(5);
  // Question ids are stable across saves (answers are keyed by them).
  await page.locator('[data-q="0:0"]').fill("On réétiquette le stock ?");
  await saved(page);
  const c2 = normalizeContent("ops", (await row(id)).content) as Extract<MemoContent, { kind: "memo" }>;
  expect(c2.qs[0]).toEqual({ id: qid, q: "On réétiquette le stock ?" });
  // The textarea grew with its two lines.
  const h = await page.locator('textarea[data-s="0"]').evaluate((t) => t.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(92);
  await page.context().close();
});

test("a failed autosave says so once, keeps the text and stores it when the connection is back", async ({ browser }) => {
  const id = await seedMemo({ team: "ops", lang: "fr", title: "Offline", author_id: ids.author, content: {} });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  const memosApi = /\/rest\/v1\/memos\?/;
  await page.route(memosApi, (r) => (r.request().method() === "PATCH" ? r.abort() : r.continue()));
  await page.locator("#fTitle").fill("Offline edit");
  await expect(page.locator("#saveState")).toHaveText(fr.saveError, { timeout: 10_000 });
  await expect(toast(page)).toHaveText(fr.saveError);
  await expect(page.locator("#fTitle")).toHaveValue("Offline edit");
  await page.unroute(memosApi);
  await saved(page); // automatic retry
  expect((await row(id)).title).toBe("Offline edit");
  await page.context().close();
});

test("'Nouveau mémo', 'Voir un mémo rempli' and the team pills of a stored memo", async ({ browser }) => {
  const id = await seedMemo({ team: "crea", lang: "fr", title: "Créa stocké", author_id: ids.author, content: {} });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  await page.locator("#bExample").click();
  await expect(toast(page)).toHaveText(fr.filled);
  await expect(page).toHaveURL(/\/memos\/new\?team=crea&example=1$/);
  await expect(page.locator("#fTitle")).toHaveValue(new RegExp("^Brancher"));
  await expect(page.locator("#steps li.done")).toHaveCount(5);

  await page.locator("#bNew").click();
  await expect(toast(page)).toHaveText(fr.newDone);
  await expect(page).toHaveURL(/\/memos\/new\?team=crea$/);
  await expect(page.locator("#fTitle")).toHaveValue("");
  await expect(page.locator("#fTitle")).toBeFocused();

  // Once stored, a team pill leads to the list filtered by that team.
  await page.goto(`/memos/${id}`);
  await page.locator('.poles button[data-p="sav"]').click();
  await expect(page).toHaveURL(/\/\?team=sav$/);
  await page.context().close();
});

test("show examples toggle hides the example boxes and is remembered", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  await expect(page.locator(".ex").first()).toBeVisible();
  await page.locator("#showEx").uncheck();
  await expect(page.locator("body")).toHaveClass(/noex/);
  await expect(page.locator(".ex").first()).toBeHidden();
  await page.reload();
  await expect(page.locator("#showEx")).not.toBeChecked();
  await expect(page.locator(".ex").first()).toBeHidden();
  await page.locator("#showEx").check();
  await expect(page.locator(".ex").first()).toBeVisible();
  await page.context().close();
});

test("ad mini memo: four sections and the 'works if' field", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=mini");
  await expect(page.locator("section.sec")).toHaveCount(4);
  await expect(page.locator('label[for="fTitle"]')).toHaveText(fr.miniTitleL);
  await expect(page.locator("#fTitle")).toHaveAttribute("placeholder", fr.miniTitlePh);
  await expect(page.locator("#acts")).toHaveCount(0);
  await page.locator('textarea[data-s="0"]').fill("Le boxer");
  await expect(page).toHaveURL(memoUrl);
  await page.locator('textarea[data-f="works"]').fill("Coût sous 35 $");
  await page.locator("#fTitle").fill("Mini concept");
  await saved(page);
  const r = await row(idFromUrl(page));
  expect(r.team).toBe("mini");
  expect(r.content).toMatchObject({ kind: "mini", works: "Coût sous 35 $", s: ["Le boxer", "", "", ""] });
  await page.reload();
  await expect(page.locator('textarea[data-f="works"]')).toHaveValue("Coût sous 35 $");
  await expect(page.locator("#steps li")).toHaveCount(4);
  await page.context().close();
});

test("FR/EN switch keeps the content and changes the labels", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  await page.locator("#fTitle").fill("Bilingual");
  await page.locator('textarea[data-s="1"]').fill("Le texte reste");
  // Switch right away: the last keystrokes may not be saved yet (remount from /memos/new to /memos/[id]).
  await page.locator('.lang button[data-l="en"]').click();
  await expect(page.locator("#s0 h2")).toHaveText(doc("en").secs[0][0] as string);
  await expect(page.locator('label[for="fTitle"]')).toHaveText(en.titleL);
  await expect(page.locator("#pTitle")).toContainText(en.steps);
  await expect(page.locator("#fTitle")).toHaveValue("Bilingual");
  await expect(page.locator('textarea[data-s="1"]')).toHaveValue("Le texte reste");
  await expect(page).toHaveURL(memoUrl);
  const id = idFromUrl(page);
  await expect.poll(async () => (await row(id)).content).toMatchObject({ s: ["", "Le texte reste", "", ""] });

  // On a stored memo the editor stays mounted; an edit in English sets the memo's language.
  await page.locator('textarea[data-s="2"]').fill("Steps");
  await saved(page, en.savedAuto);
  expect((await row(id)).lang).toBe("en");
  await page.locator('.lang button[data-l="fr"]').click();
  await expect(page.locator("#s0 h2")).toHaveText(doc("fr").secs[0][0] as string);
  await expect(page.locator('textarea[data-s="2"]')).toHaveValue("Steps");
  await page.context().close();
});

test("submit needs a title and a decision maker, then the memo is to decide", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  const submit = page.locator('#decision button[data-t="submit"]');
  await expect(page.locator("#memoStatus")).toHaveText(fr.status.draft);
  await submit.click();
  await expect(toast(page)).toHaveText(fr.needTitle);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("fTitle");
  await page.keyboard.type("Décider le réétiquetage");
  await expect(page).toHaveURL(memoUrl);
  await submit.click();
  await expect(toast(page)).toHaveText(fr.needDecider);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("fDecider");

  // By id: another "Ed Decider" (another run's prefix) would be listed as "Ed Decider · email".
  await page.locator("#fDecider").selectOption(ids.decider);
  // Choosing the decider fills "À" when it is empty.
  await expect(page.locator('[data-m="0"]')).toHaveValue("Ed Decider");
  await page.locator('[data-q="0:0"]').fill("On réétiquette le stock ?");
  await submit.click();
  await expect(toast(page)).toHaveText(fr.sentDone);
  await expect(page.locator("#memoStatus")).toHaveText(fr.status.to_decide);
  const id = idFromUrl(page);
  expect(await row(id)).toMatchObject({ status: "to_decide", decider_id: ids.decider, title: "Décider le réétiquetage" });
  // Still editable by the author while to decide; withdraw + archive offered.
  await expect(page.locator("#fTitle")).not.toHaveAttribute("readonly", "");
  await expect(page.locator('#decision button[data-t="withdraw"]')).toBeVisible();
  await expect(page.locator('#decision button[data-t="decide"]')).toHaveCount(0);
  ids.flow = id;
  await page.context().close();
});

test("the decision maker answers; the author reads the answers and is locked once decided", async ({ browser }) => {
  const id = ids.flow;
  const decider = await as(browser, DECIDER, `/memos/${id}`);
  await expect(decider.locator("#fTitle")).toHaveAttribute("readonly", "");
  await expect(decider.locator("#addQ")).toHaveCount(0);
  await expect(decider.locator("#decision .dnote.ro")).toHaveText(fr.notAuthor);
  const qa = decider.locator("textarea.qa").first();
  await expect(qa).toHaveAttribute("placeholder", fr.aPh);
  await qa.fill("Oui, on réétiquette.");
  await saved(decider, fr.answerSaved);
  const { data: answers } = await admin().from("memo_answers").select("*").eq("memo_id", id);
  expect(answers).toHaveLength(1);
  expect(answers![0]).toMatchObject({ answer: "Oui, on réétiquette.", answered_by: ids.decider });

  const author = await as(browser, AUTHOR, `/memos/${id}`);
  const aqa = author.locator("textarea.qa").first();
  await expect(aqa).toHaveValue("Oui, on réétiquette.");
  await expect(aqa).toHaveAttribute("readonly", "");
  await expect(author.locator('#decision button[data-t="decide"]')).toHaveCount(0);

  await decider.locator('#decision button[data-t="decide"]').click();
  await expect(toast(decider)).toHaveText(fr.decidedDone);
  await expect(decider.locator("#memoStatus")).toHaveText(fr.status.decided);
  await expect(decider.locator("#decision .dnote").first()).toContainText(fr.decidedOn.replace(" {date}", ""));
  await expect(decider.locator("textarea.qa").first()).toHaveAttribute("readonly", "");

  await author.reload();
  await expect(author.locator("#memoStatus")).toHaveText(fr.status.decided);
  await expect(author.locator("#fTitle")).toHaveAttribute("readonly", "");
  await expect(author.locator('[data-nc="0"]')).toBeDisabled();
  await expect(author.locator("#addAct")).toHaveCount(0);
  await expect(author.locator(".del")).toHaveCount(0);
  await expect(author.locator("#fDecider")).toHaveText("Ed Decider");
  await expect(author.locator("#decision .dnote.ro")).toHaveText(fr.lockedDecided);
  // An edit attempt changes nothing.
  await author.locator('textarea[data-s="0"]').pressSequentially("x");
  await expect(author.locator('textarea[data-s="0"]')).toHaveValue("");
  await decider.context().close();
  await author.context().close();
});

test("decide / reopen / archive / restore follow the workflow rules", async ({ browser }) => {
  const id = ids.flow;
  const author = await as(browser, AUTHOR, `/memos/${id}`);
  const decider = await as(browser, DECIDER, `/memos/${id}`);
  const btn = (p: Page, t: string) => p.locator(`#decision button[data-t="${t}"]`);

  // decided: the decider may reopen or archive, the author only archive.
  await expect(btn(decider, "reopen")).toBeVisible();
  await expect(btn(decider, "archive")).toBeVisible();
  await expect(btn(author, "reopen")).toHaveCount(0);
  await expect(btn(author, "archive")).toBeVisible();

  await btn(decider, "reopen").click();
  await expect(toast(decider)).toHaveText(fr.reopenedDone);
  await expect(decider.locator("#memoStatus")).toHaveText(fr.status.to_decide);
  await expect(decider.locator("textarea.qa").first()).not.toHaveAttribute("readonly", "");

  await author.reload();
  await btn(author, "withdraw").click();
  await expect(toast(author)).toHaveText(fr.draftDone);
  await expect(author.locator("#memoStatus")).toHaveText(fr.status.draft);
  await btn(author, "archive").click();
  await expect(toast(author)).toHaveText(fr.archivedDone);
  await expect(author.locator("#memoStatus")).toHaveText(fr.status.archived);
  await expect(author.locator("#decision .dnote.ro")).toHaveText(fr.lockedArchived);
  await expect(author.locator("#fTitle")).toHaveAttribute("readonly", "");

  await decider.reload();
  await expect(btn(decider, "restore")).toHaveCount(0);
  await expect(decider.locator("#decision .dacts button")).toHaveCount(0);

  await btn(author, "restore").click();
  await expect(toast(author)).toHaveText(fr.restoredDone);
  await expect(author.locator("#memoStatus")).toHaveText(fr.status.draft);
  await expect(author.locator("#fTitle")).not.toHaveAttribute("readonly", "");
  expect((await row(id)).status).toBe("draft");
  await author.context().close();
  await decider.context().close();
});

test("a reader of the same team sees the memo read-only; an outsider gets 'not found'", async ({ browser }) => {
  const id = ids.flow;
  const reader = await as(browser, READER, `/memos/${id}`);
  await expect(reader.locator("#fTitle")).toHaveValue("Décider le réétiquetage");
  await expect(reader.locator("#fTitle")).toHaveAttribute("readonly", "");
  await expect(reader.locator("textarea.qa").first()).toHaveAttribute("placeholder", fr.answerWait);
  await expect(reader.locator("textarea.qa").first()).toHaveValue("Oui, on réétiquette.");
  await expect(reader.locator("#decision .dacts button")).toHaveCount(0);
  await expect(reader.locator("select#fDecider")).toHaveCount(0);
  await expect(reader.locator("#decision .dnote.ro")).toHaveText(fr.notAuthor);
  await expect(reader.locator("#addAct")).toHaveCount(0);
  // Exports work for readers too.
  await expect(reader.locator("#bCopy")).toBeVisible();
  await reader.context().close();

  // An admin sees every memo and may edit it and use every step.
  const adm = await as(browser, ADMIN, `/memos/${id}`);
  await expect(adm.locator("#fTitle")).not.toHaveAttribute("readonly", "");
  await expect(adm.locator('#decision button[data-t="submit"]')).toBeVisible();
  await expect(adm.locator('#decision button[data-t="archive"]')).toBeVisible();
  await expect(adm.locator("#decision .dnote.ro")).toHaveCount(0);
  await adm.context().close();

  const outsider = await as(browser, OUTSIDER, "/memos/new?team=finance");
  const res = await outsider.goto(`/memos/${id}`);
  expect(res?.status()).toBe(404);
  // The shared 404 card (src/components/notfound/NotFoundCard.tsx).
  await expect(outsider.locator(".solo-card .intro")).toHaveText(fr.notFound);
  await expect(outsider.locator(".solo-card a.btn")).toHaveAttribute("href", "/");
  // The tab title is the 404's, never the memo's.
  await expect(outsider).not.toHaveTitle(/réétiquetage/);
  const bad = await outsider.goto("/memos/not-a-uuid");
  expect(bad?.status()).toBe(404);
  await expect(outsider.locator(".solo-card .intro")).toHaveText(fr.notFound);
  await outsider.context().close();
});

test("delete drafts from 'Mes mémos' (two steps); only drafts can be deleted", async ({ browser }) => {
  const other = await seedMemo({ team: "ops", lang: "fr", title: "Brouillon à jeter", author_id: ids.author, content: {} });
  const current = await seedMemo({ team: "ops", lang: "fr", title: "Mémo courant", author_id: ids.author, content: {} });
  const page = await as(browser, AUTHOR, `/memos/${current}`);
  const item = (title: string) => page.locator("#memos li", { hasText: title });
  await expect(item("Mémo courant")).toHaveClass("cur");
  await expect(item("Brouillon à jeter")).toBeVisible();
  // The to-decide memo of the earlier tests is a draft again; make one non-draft to check.
  await admin().from("memos").update({ status: "to_decide", decider_id: ids.decider }).eq("id", ids.flow);
  await page.reload();
  await expect(item("Décider le réétiquetage").locator(".rm")).toHaveCount(0);

  const rm = item("Brouillon à jeter").locator(".rm");
  await rm.click();
  await expect(rm).toHaveText(fr.sure);
  await expect(rm).toHaveClass(/sure/);
  await rm.click();
  await expect(toast(page)).toHaveText(fr.deleted);
  await expect(item("Brouillon à jeter")).toHaveCount(0);
  expect((await admin().from("memos").select("id").eq("id", other)).data).toHaveLength(0);

  // Opening another memo from the list.
  await item("Décider le réétiquetage").locator(".open").click();
  await expect(page).toHaveURL(new RegExp(`/memos/${ids.flow}$`));
  await expect(toast(page)).toHaveText(fr.opened);
  await page.goBack();
  await expect(page.locator("#fTitle")).toHaveValue("Mémo courant");

  // Deleting the memo being edited goes to a new blank memo.
  const cur = item("Mémo courant").locator(".rm");
  await cur.click();
  await cur.click();
  await expect(page).toHaveURL(/\/memos\/new\?team=ops$/);
  expect((await admin().from("memos").select("id").eq("id", current)).data).toHaveLength(0);
  await expect(page.locator("#fTitle")).toHaveValue("");
  await page.context().close();
});

test("Copy for Asana puts the prototype HTML on the clipboard, or opens the manual copy", async ({ browser }) => {
  const page = await as(browser, AUTHOR, `/memos/${ids.flow}`, { clipboard: true });
  await page.locator("#bCopy").click();
  await expect(toast(page)).toHaveText(fr.copied);
  const r = await row(ids.flow);
  const expected = asanaHTML({
    team: "ops",
    lang: "fr",
    title: r.title,
    content: normalizeContent("ops", r.content),
    answers: Object.fromEntries(
      ((await admin().from("memo_answers").select("question_id, answer").eq("memo_id", ids.flow)).data ?? []).map((a) => [
        a.question_id,
        a.answer,
      ]),
    ),
  });
  expect(expected).toContain("→ Oui, on réétiquette.");
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return {
      html: await (await item.getType("text/html")).text(),
      text: await (await item.getType("text/plain")).text(),
    };
  });
  expect(clip.html).toContain(expected);
  expect(clip.text).toBe(htmlToText(expected));
  await page.context().close();

  // Clipboard refused: the text is shown, selected, in the manual-copy modal.
  const manual = await as(browser, AUTHOR, `/memos/${ids.flow}`);
  await manual.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { write: () => Promise.reject(new Error("no")), writeText: () => Promise.reject(new Error("no")) },
    });
  });
  await manual.locator("#bCopy").click();
  await expect(manual.locator(".modal.open #mTitle")).toHaveText(fr.manual);
  await expect(manual.locator("#mText")).toHaveValue(htmlToText(expected));
  expect(await manual.evaluate(() => document.activeElement?.id)).toBe("mText");
  await manual.locator("#mClose").click();
  await expect(manual.locator(".modal.open")).toHaveCount(0);
  await manual.context().close();
});

test("Download PDF saves a file named like pdfFileName()", async ({ browser }) => {
  const page = await as(browser, AUTHOR, `/memos/${ids.flow}`);
  const r = await row(ids.flow);
  const name = pdfFileName({ team: "ops", lang: "fr", title: r.title, content: normalizeContent("ops", r.content) });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 45_000 }), page.locator("#bPdf").click()]);
  expect(download.suggestedFilename()).toBe(name);
  await expect(toast(page)).toHaveText(fr.saved);
  await page.context().close();
});
