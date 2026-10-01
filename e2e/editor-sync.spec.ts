// End-to-end: several people / tabs on the same memo (findings 2, 3, 5 of the
// review): answers to a question the author removed never block the decider,
// edits made elsewhere are merged instead of overwritten (with a warning when
// both changed the same text), and a memo locked meanwhile never keeps or
// exports unsaved text. Users and data: `fe-sync-`.
import { expect, test } from "@playwright/test";
import { admin, cleanupUser, ensureUser, seedMemo } from "./support";
import { as, fr, fullContent, row, saved, toast } from "./editor-support";

test.describe.configure({ mode: "serial" });

const AUTHOR = "fe-sync-author@boxhero.test";
const DECIDER = "fe-sync-decider@boxhero.test";
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  for (const e of [AUTHOR, DECIDER]) await cleanupUser(e);
  ids.author = (await ensureUser(AUTHOR, { fullName: "Fe Sync Author", teams: ["ops"], isAdmin: false })).id;
  ids.decider = (await ensureUser(DECIDER, { fullName: "Fe Sync Decider", teams: ["ops"], isAdmin: false })).id;
});
test.afterAll(async () => {
  for (const e of [AUTHOR, DECIDER]) await cleanupUser(e);
});

const answers = async (id: string) =>
  Object.fromEntries(((await admin().from("memo_answers").select("question_id, answer").eq("memo_id", id)).data ?? []).map((a) => [a.question_id, a.answer]));

test("the author removes a question while the decider answers: the other answers and the decision still go through", async ({
  browser,
}) => {
  const id = await seedMemo({
    team: "ops",
    lang: "fr",
    title: "Questions retirées",
    author_id: ids.author,
    decider_id: ids.decider,
    status: "to_decide",
    content: fullContent(),
  });
  const decider = await as(browser, DECIDER, `/memos/${id}`);
  const author = await as(browser, AUTHOR, `/memos/${id}`);
  await author.locator('#qs [data-dq="1"]').click();
  await saved(author);

  // The decider's page still shows the removed question.
  await decider.locator('textarea[data-qid="q2"]').fill("Réponse à une question retirée");
  await decider.locator('textarea[data-qid="q1"]').fill("Oui, on y va.");
  await expect(toast(decider)).toHaveText(fr.answerDropped);
  await saved(decider, fr.answerSaved);
  expect(await answers(id)).toEqual({ q1: "Oui, on y va." });
  // The page was refreshed: the removed question is gone.
  await expect(decider.locator("#qs .qrow")).toHaveCount(1);

  await decider.locator('#decision button[data-t="decide"]').click();
  await expect(toast(decider)).toHaveText(fr.decidedDone);
  expect((await row(id)).status).toBe("decided");
  await decider.context().close();
  await author.context().close();
});

test("two tabs edit the same memo: different fields are both kept, the same field warns and keeps the last edit", async ({
  browser,
}) => {
  const id = await seedMemo({ team: "ops", lang: "fr", title: "Deux onglets", author_id: ids.author, content: fullContent() });
  const a = await as(browser, AUTHOR, `/memos/${id}`);
  const b = await as(browser, AUTHOR, `/memos/${id}`);

  await a.locator('textarea[data-s="0"]').fill("Pourquoi (onglet A)");
  await saved(a);
  // B never saw A's edit: its save is merged, not a full overwrite.
  await b.locator('textarea[data-s="1"]').fill("Quoi (onglet B)");
  await saved(b);
  let r = await row(id);
  expect((r.content as { s: string[] }).s.slice(0, 2)).toEqual(["Pourquoi (onglet A)", "Quoi (onglet B)"]);
  await expect(b.locator('textarea[data-s="0"]')).toHaveValue("Pourquoi (onglet A)");
  await expect(b.locator(".toast")).not.toHaveText(fr.editedElsewhere);

  // Both change the title: B (last) wins, and B is told to check the text.
  await a.locator("#fTitle").fill("Titre de A");
  await saved(a);
  await b.locator("#fTitle").fill("Titre de B");
  await expect(toast(b)).toHaveText(fr.editedElsewhere);
  await saved(b);
  r = await row(id);
  expect(r.title).toBe("Titre de B");

  // A comes back to its tab with nothing pending: it shows what changed elsewhere.
  await expect(a.locator("#fTitle")).toHaveValue("Titre de A");
  await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(a.locator("#fTitle")).toHaveValue("Titre de B");
  await expect(a.locator('textarea[data-s="1"]')).toHaveValue("Quoi (onglet B)");
  await a.context().close();
  await b.context().close();
});

test("decided meanwhile: unsaved text is dropped, the sheet is locked and exports only show what is stored", async ({
  browser,
}) => {
  const id = await seedMemo({
    team: "ops",
    lang: "fr",
    title: "Verrouillé ailleurs",
    author_id: ids.author,
    decider_id: ids.decider,
    status: "to_decide",
    content: fullContent(),
  });
  const page = await as(browser, AUTHOR, `/memos/${id}`);
  await expect(page.locator("#memoStatus")).toHaveText(fr.status.to_decide);
  // The decision maker decides in another place.
  await admin().from("memos").update({ status: "decided" }).eq("id", id);

  await page.locator('textarea[data-s="0"]').fill("Texte jamais enregistré");
  await expect(toast(page)).toHaveText(fr.lockedDecided);
  await expect(page.locator("#memoStatus")).toHaveText(fr.status.decided);
  await expect(page.locator('textarea[data-s="0"]')).toHaveValue("Pourquoi");
  await expect(page.locator('textarea[data-s="0"]')).toHaveAttribute("readonly", "");
  await expect(page.locator("#decision .dnote.ro")).toHaveText(fr.lockedDecided);
  await expect(page.locator("#saveState")).not.toHaveText(fr.saveError);
  // PDF sheet (and Copy for Asana, same data): the stored text only.
  expect(await page.locator("#exp").innerHTML()).not.toContain("Texte jamais enregistré");
  expect(((await row(id)).content as { s: string[] }).s[0]).toBe("Pourquoi");
  // Not restored after a reload either.
  await page.reload();
  await expect(page.locator('textarea[data-s="0"]')).toHaveValue("Pourquoi");
  await page.context().close();
});
