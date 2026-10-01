// End-to-end: editor details from the review — focus after workflow steps
// (D4), status badge colours (D3), read-only sheets without writing prompts,
// homonyms in the decider list, row-specific delete labels, the mini memo's
// "decide" button (D14), dates in BoxHero's time zone, line breaks of answers
// in the exports (finding 12) and "Send to Asana" (finding 11: saves pending
// edits first, not offered to readers). Users and data: `fe-det-`.
import { type Server, createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { admin, cleanupUser, ensureUser, seedMemo } from "./support";
import { as, fr, fullContent, memoUrl, saved, toast } from "./editor-support";

test.describe.configure({ mode: "serial" });

const AUTHOR = "fe-det-author@boxhero.test";
const DECIDER = "fe-det-decider@boxhero.test";
const READER = "fe-det-reader@boxhero.test";
const TWIN1 = "fe-det-twin1@boxhero.test";
const TWIN2 = "fe-det-twin2@boxhero.test";
const USERS = [AUTHOR, DECIDER, READER, TWIN1, TWIN2];
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  for (const e of USERS) await cleanupUser(e);
  ids.author = (await ensureUser(AUTHOR, { fullName: "Fe Det Author", teams: ["ops", "mini"], isAdmin: false })).id;
  ids.decider = (await ensureUser(DECIDER, { fullName: "Fe Det Decider", teams: ["ops"], isAdmin: false })).id;
  ids.reader = (await ensureUser(READER, { fullName: "Fe Det Reader", teams: ["ops", "mini"], isAdmin: false })).id;
  ids.twin1 = (await ensureUser(TWIN1, { fullName: "Fe Homonyme", teams: [], isAdmin: false })).id;
  ids.twin2 = (await ensureUser(TWIN2, { fullName: "Fe Homonyme", teams: [], isAdmin: false })).id;
});
test.afterAll(async () => {
  for (const e of USERS) await cleanupUser(e);
});

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

test("after a workflow step the focus stays in the decision panel; the badge uses the list's colours", async ({ browser }) => {
  const page = await as(browser, AUTHOR, "/memos/new?team=ops");
  const badge = page.locator("#memoStatus");
  await expect(badge).toHaveCSS("color", "rgb(91, 100, 114)"); // draft: --muted on --soft
  await page.locator("#fTitle").fill("Focus après envoi");
  await expect(page).toHaveURL(memoUrl);
  await page.locator("#fDecider").selectOption(ids.decider);
  // Homonyms are told apart by their email.
  await expect(page.locator("#fDecider option", { hasText: "Fe Homonyme · fe-det-twin1@boxhero.test" })).toHaveCount(1);
  await expect(page.locator("#fDecider option", { hasText: "Fe Homonyme · fe-det-twin2@boxhero.test" })).toHaveCount(1);
  await page.locator('#decision button[data-t="submit"]').focus();
  await page.keyboard.press("Enter");
  await expect(toast(page)).toHaveText(fr.sentDone);
  await expect(badge).toHaveText(fr.status.to_decide);
  await expect(page.locator("#dHead")).toBeFocused();
  await expect(badge).toHaveCSS("background-color", rgb("#FDF0D5"));
  await expect(badge).toHaveCSS("color", rgb("#8A5300"));

  // Same colours after arriving from the list (list.css loaded, its .st-* rules are global).
  await page.goto("/");
  await page.locator(".lst-title", { hasText: "Focus après envoi" }).click();
  await expect(page).toHaveURL(memoUrl);
  await expect(badge).toHaveCSS("background-color", rgb("#FDF0D5"));
  await expect(badge).toHaveCSS("border-top-style", "solid");
  await page.context().close();
});

test("read-only sheets show no writing prompts; delete buttons say which row they remove; mini 'decide' says nothing about answers", async ({
  browser,
}) => {
  const id = await seedMemo({
    team: "ops",
    lang: "fr",
    title: "Lecture",
    author_id: ids.author,
    decider_id: ids.decider,
    status: "to_decide",
    content: fullContent({ s: ["", "", "", ""] }),
  });
  const reader = await as(browser, READER, `/memos/${id}`);
  await expect(reader.locator("#fTitle")).not.toHaveAttribute("placeholder", /./);
  await expect(reader.locator('textarea[data-s="0"]')).not.toHaveAttribute("placeholder", /./);
  await expect(reader.locator('[data-a="0:1"]')).not.toHaveAttribute("placeholder", /./);
  await expect(reader.locator("textarea.qa").first()).toHaveAttribute("placeholder", fr.answerWait);
  // Readers cannot send to Asana (the route would refuse): no button.
  await expect(reader.locator("#bAsana")).toHaveCount(0);
  await reader.context().close();

  const author = await as(browser, AUTHOR, `/memos/${id}`);
  await expect(author.locator('textarea[data-s="0"]')).toHaveAttribute("placeholder", /./);
  await expect(author.locator('#acts [data-da="0"]')).toHaveAttribute("aria-label", "Supprimer : Agir");
  await expect(author.locator('#qs [data-dq="1"]')).toHaveAttribute("aria-label", "Supprimer : Question 2 ?");
  await author.locator("#addQ").click();
  await expect(author.locator('#qs [data-dq="2"]')).toHaveAttribute("aria-label", `Supprimer : ${fr.qPh}`);
  await author.context().close();

  const mini = await seedMemo({
    team: "mini",
    lang: "fr",
    title: "Mini à décider",
    author_id: ids.author,
    decider_id: ids.decider,
    status: "to_decide",
    content: { kind: "mini", author: "", meta: ["", "", "", ""], s: ["", "", "", ""], works: "" },
  });
  const decider = await as(browser, DECIDER, `/memos/${mini}`);
  const decide = decider.locator('#decision button[data-t="decide"]');
  await expect(decide).toBeVisible();
  await expect(decide.locator("small")).toHaveCount(0);
  await decide.click();
  await expect(toast(decider)).toHaveText(fr.decidedDone);
  await expect(decider.locator("#dHead")).toBeFocused();
  await expect(decider.locator("#memoStatus")).toHaveCSS("background-color", rgb("#E2F3E9"));
  await decider.context().close();
});

test("rail dates are in BoxHero's time zone, like the list, whatever the browser's zone", async ({ browser }) => {
  const id = await seedMemo({
    team: "ops",
    lang: "fr",
    title: "Date de Paris",
    author_id: ids.author,
    content: fullContent(),
    updated_at: "2020-09-29T07:00:00Z",
  });
  const page = await as(browser, AUTHOR, `/memos/${id}`, { context: { timezoneId: "America/New_York" } });
  await expect(page.locator("#memos li", { hasText: "Date de Paris" }).locator("span")).toHaveText("29 septembre à 09:00");
  await page.context().close();
});

test("a multi-line answer keeps its line breaks in Copy for Asana and the PDF sheet", async ({ browser }) => {
  const id = await seedMemo({
    team: "ops",
    lang: "fr",
    title: "Réponse sur deux lignes",
    author_id: ids.author,
    decider_id: ids.decider,
    status: "to_decide",
    content: fullContent(),
  });
  const page = await as(browser, DECIDER, `/memos/${id}`, { clipboard: true });
  await page.locator('textarea[data-qid="q1"]').fill("Oui.\nMais pas avant lundi.");
  await saved(page, fr.answerSaved);
  await page.locator("#bCopy").click();
  await expect(toast(page)).toHaveText(fr.copied);
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return { html: await (await item.getType("text/html")).text(), text: await (await item.getType("text/plain")).text() };
  });
  expect(clip.html).toContain("<li>Question 1 ?<br>→ Oui.<br>Mais pas avant lundi.</li>");
  expect(clip.text).toContain("Question 1 ?\n→ Oui.\nMais pas avant lundi.");
  expect(await page.locator("#exp").innerHTML()).toContain("→ Oui.<br>Mais pas avant lundi.</li>");
  await page.context().close();
});

// ---------- Send to Asana (needs the app started with the Asana mock settings, like asana.spec.ts) ----------

const PORT = Number(process.env.E2E_ASANA_MOCK_PORT ?? 0);

test.describe("Send to Asana", () => {
  test.skip(!PORT, "set E2E_ASANA_MOCK_PORT (and start the app with ASANA_API_BASE pointing to it)");
  let server: Server;
  const names: string[] = [];
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const data = raw ? (JSON.parse(raw) as { data?: { name?: string } }).data : undefined;
        if (req.method === "POST" && data?.name) names.push(data.name);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { gid: "1300000000000099", permalink_url: "https://app.asana.com/0/1/1300000000000099" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  });
  test.afterAll(() => {
    server?.close();
  });

  test("the edit typed just before the click is saved first, then sent", async ({ browser }) => {
    const id = await seedMemo({
      team: "ops",
      lang: "fr",
      title: "Avant Asana",
      author_id: ids.author,
      decider_id: ids.decider,
      content: fullContent(),
    });
    const page = await as(browser, AUTHOR, `/memos/${id}`);
    await page.locator("#fTitle").fill("Juste avant Asana");
    // At once, before the autosave delay.
    await page.locator("#bAsana").click();
    await expect(toast(page)).toHaveText(fr.asanaDone);
    expect(names).toEqual(["MÉMO : Juste avant Asana"]);
    const { data } = await admin().from("memos").select("title, asana_task_gid").eq("id", id).single();
    expect(data).toEqual({ title: "Juste avant Asana", asana_task_gid: "1300000000000099" });
    await page.context().close();
  });
});
