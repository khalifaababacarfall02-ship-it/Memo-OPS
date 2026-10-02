// POST /api/asana end to end: signed-in browser session → RLS read of the
// memo → Asana API (a local mock server standing in for app.asana.com) →
// memos.asana_task_gid saved. Needs the app started with:
//   ASANA_ACCESS_TOKEN=e2e-dummy-token ASANA_PROJECT_GID=1200000000000001
//   ASANA_API_BASE=http://127.0.0.1:$E2E_ASANA_MOCK_PORT/api/1.0
// and E2E_ASANA_MOCK_PORT set here (the spec starts the mock on it). Skipped otherwise.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { type APIResponse, type Page, expect, test } from "@playwright/test";
import { admin, cleanupUser, ensureUser, seedMemo, signIn } from "./support";

const PORT = Number(process.env.E2E_ASANA_MOCK_PORT ?? 0);
const TOKEN = process.env.E2E_ASANA_TOKEN ?? "e2e-dummy-token";
const PROJECT = process.env.E2E_ASANA_PROJECT_GID ?? "1200000000000001";
const FOREIGN_TASK = "1400000000000001";

const AUTHOR = "tm-asana-author@boxhero.test";
const DECIDER = "tm-asana-decider@boxhero.test";
const READER = "tm-asana-reader@boxhero.test";
const OUTSIDER = "tm-asana-outsider@boxhero.test";
const USERS = [AUTHOR, DECIDER, READER, OUTSIDER];

test.describe.configure({ mode: "serial" });
test.skip(!PORT, "set E2E_ASANA_MOCK_PORT (and start the app with ASANA_API_BASE pointing to it)");

// ---------- the mock Asana API ----------

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | undefined;
  data: Record<string, unknown> | null;
}
const seen: Seen[] = [];
const tasks = new Map<string, { project: string; name: string; notes: string; assignee: string | null }>();
const rejected = new Set<string>(); // assignees Asana does not know
let down = false;
let nextGid = 1300000000000001;
let server: Server;
// When > 0, task creations wait until that many have arrived, then all are answered
// (two sends racing each other).
let holdCreates = 0;
const held: (() => void)[] = [];
const waitForOtherCreates = () =>
  new Promise<void>((resolve) => {
    held.push(resolve);
    if (held.length >= holdCreates) {
      holdCreates = 0;
      for (const release of held.splice(0)) release();
    }
  });

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
  });

function startMock(): Promise<void> {
  tasks.set(FOREIGN_TASK, { project: "9999", name: "Someone else's task", notes: "", assignee: null });
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const raw = await body(req);
    const data = raw ? ((JSON.parse(raw) as { data?: Record<string, unknown> }).data ?? null) : null;
    seen.push({ method: req.method ?? "", path: url.pathname, query: url.searchParams, auth: req.headers.authorization, data });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { errors: [{ message: "Not Authorized" }] });
    if (down) return send(500, { errors: [{ message: "Server Error", phrase: "6 sad squid snuggle softly" }] });
    const link = (gid: string, project: string) => `https://app.asana.com/0/${project}/${gid}`;
    const m = url.pathname.match(/^\/api\/1\.0\/tasks(?:\/(\d+))?$/);
    if (!m) return send(404, { errors: [{ message: "No matching route" }] });
    const gid = m[1];
    const assignee = typeof data?.assignee === "string" ? data.assignee : null;
    if (assignee && rejected.has(assignee)) {
      return send(400, { errors: [{ message: `assignee: Not a recognized ID: ${assignee}` }] });
    }
    if (req.method === "POST" && !gid) {
      if (holdCreates > 0) await waitForOtherCreates();
      const projects = (data?.projects as string[]) ?? [];
      if (projects.length !== 1) return send(400, { errors: [{ message: "projects: Missing input" }] });
      const newGid = String(nextGid++);
      tasks.set(newGid, { project: projects[0], name: String(data?.name), notes: String(data?.html_notes), assignee });
      return send(201, { data: { gid: newGid, permalink_url: link(newGid, projects[0]) } });
    }
    const task = gid ? tasks.get(gid) : undefined;
    if (!gid || !task) return send(404, { errors: [{ message: `task: Unknown object: ${gid}` }] });
    if (req.method === "GET") {
      return send(200, { data: { gid, memberships: [{ project: { gid: task.project } }], permalink_url: link(gid, task.project) } });
    }
    if (req.method === "PUT") {
      Object.assign(task, { name: String(data?.name), notes: String(data?.html_notes) }, assignee ? { assignee } : {});
      return send(200, { data: { gid, permalink_url: link(gid, task.project) } });
    }
    if (req.method === "DELETE") {
      tasks.delete(gid);
      return send(200, { data: {} });
    }
    return send(405, { errors: [{ message: "Method not allowed" }] });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
}

// ---------- fixtures ----------

let ids: Record<string, string> = {};
let memoId = "";
const title = `tm asana ${Date.now()}`;

test.beforeAll(async () => {
  await startMock();
  ids = {
    [AUTHOR]: (await ensureUser(AUTHOR, { fullName: "Ali Auteur", teams: [], isAdmin: false })).id,
    [DECIDER]: (await ensureUser(DECIDER, { fullName: "Dina Décide", teams: [], isAdmin: false })).id,
    [READER]: (await ensureUser(READER, { fullName: "Rémi Lecteur", teams: ["growth"], isAdmin: false })).id,
    [OUTSIDER]: (await ensureUser(OUTSIDER, { fullName: "Oscar Dehors", teams: [], isAdmin: false })).id,
  };
  memoId = await seedMemo({
    team: "growth",
    lang: "fr",
    title,
    author_id: ids[AUTHOR],
    decider_id: ids[DECIDER],
    status: "to_decide",
    content: {
      kind: "memo",
      author: "Ali",
      meta: ["Dina", "Ali", "lundi", "Pub Meta"],
      s: ["Parce que <b>ça</b> coûte & ça presse", "Le quoi", "Le comment", "Maintenant"],
      acts: [],
      needs: [],
      res: "",
      qs: [{ id: "q1", q: "On relance la pub ?" }],
    },
  });
  const { error } = await admin()
    .from("memo_answers")
    .insert({ memo_id: memoId, question_id: "q1", answer: "Oui, lundi.", answered_by: ids[DECIDER] });
  if (error) throw new Error(error.message);
});

test.afterAll(async () => {
  server?.close();
  const a = admin();
  for (const email of USERS) await cleanupUser(email);
  const userIds = Object.values(ids);
  if (userIds.length) {
    await a.from("team_members").delete().in("user_id", userIds);
    for (const id of userIds) await a.auth.admin.deleteUser(id);
  }
});

async function as(browser: import("@playwright/test").Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await signIn(page, email, "/");
  return page;
}

const sendAsana = (page: Page, payload: unknown = { memoId }) => page.request.post("/api/asana", { data: payload });

async function json(res: APIResponse) {
  const text = await res.text();
  expect(text).not.toContain(TOKEN);
  return JSON.parse(text);
}

const storedGid = async () =>
  (await admin().from("memos").select("asana_task_gid").eq("id", memoId).single()).data?.asana_task_gid ?? null;

// ---------- tests ----------

test("the author sends the memo: task created in the Memos project, assigned to the decision maker, gid saved", async ({
  browser,
}) => {
  const page = await as(browser, AUTHOR);
  const res = await sendAsana(page);
  expect(res.status()).toBe(200);
  const out = await json(res);
  expect(out).toEqual({
    gid: "1300000000000001",
    url: `https://app.asana.com/0/${PROJECT}/1300000000000001`,
    assigned: true,
    updated: false,
  });
  expect(await storedGid()).toBe("1300000000000001");

  const create = seen.find((s) => s.method === "POST")!;
  expect(create.path).toBe("/api/1.0/tasks");
  expect(create.query.get("opt_fields")).toBe("permalink_url");
  expect(create.auth).toBe(`Bearer ${TOKEN}`);
  expect(create.data).toMatchObject({ projects: [PROJECT], assignee: DECIDER, name: `MÉMO : ${title}` });
  const notes = String(create.data?.html_notes);
  expect(notes.startsWith("<body>")).toBe(true);
  expect(notes).toContain(`/memos/${memoId}">Ouvrir le mémo dans l’app</a>`);
  expect(notes).toContain("Parce que &lt;b&gt;ça&lt;/b&gt; coûte &amp; ça presse");
  expect(notes).toContain("→ Oui, lundi.");
  await page.context().close();
});

test("sending again updates the same task (checked to be in the Memos project)", async ({ browser }) => {
  const page = await as(browser, DECIDER);
  seen.length = 0;
  const out = await json(await sendAsana(page));
  expect(out).toMatchObject({ gid: "1300000000000001", updated: true, assigned: true });
  expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
    "GET /api/1.0/tasks/1300000000000001",
    "PUT /api/1.0/tasks/1300000000000001",
  ]);
  expect(seen[0].query.get("opt_fields")).toBe("memberships.project.gid,permalink_url");
  expect(seen[1].data).not.toHaveProperty("projects");
  await page.context().close();
});

test("a gid pointing outside the Memos project is never updated: a new task replaces it", async ({ browser }) => {
  // Any author could write any gid into the column through the API.
  await admin().from("memos").update({ asana_task_gid: FOREIGN_TASK }).eq("id", memoId);
  const page = await as(browser, AUTHOR);
  seen.length = 0;
  const out = await json(await sendAsana(page));
  expect(out).toMatchObject({ gid: "1300000000000002", updated: false });
  expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
    `GET /api/1.0/tasks/${FOREIGN_TASK}`,
    "POST /api/1.0/tasks",
  ]);
  expect(tasks.get(FOREIGN_TASK)?.name).toBe("Someone else's task");
  expect(await storedGid()).toBe("1300000000000002");
  await page.context().close();
});

test("an unknown assignee: the task is still created, unassigned", async ({ browser }) => {
  await admin().from("memos").update({ asana_task_gid: null }).eq("id", memoId);
  rejected.add(DECIDER);
  const page = await as(browser, AUTHOR);
  seen.length = 0;
  const out = await json(await sendAsana(page));
  expect(out).toMatchObject({ gid: "1300000000000003", assigned: false, updated: false });
  expect(seen.map((s) => [s.method, s.data?.assignee ?? null])).toEqual([
    ["POST", DECIDER],
    ["POST", null],
  ]);
  rejected.clear();
  await page.context().close();
});

test("Asana down: generic error, nothing saved, no Asana internals leaked", async ({ browser }) => {
  const before = await storedGid();
  down = true;
  const page = await as(browser, AUTHOR);
  const res = await sendAsana(page);
  expect(res.status()).toBe(502);
  const text = await res.text();
  expect(text).toBe(JSON.stringify({ error: "asanaError" }));
  expect(text).not.toContain("squid");
  expect(await storedGid()).toBe(before);
  down = false;
  await page.context().close();
});

test("who may send: readers get 403, people without access 404, bad input 400, no decision maker 409", async ({
  browser,
}) => {
  const reader = await as(browser, READER);
  expect(await json(await sendAsana(reader))).toEqual({ error: "forbidden" });
  const outsider = await as(browser, OUTSIDER);
  const hidden = await sendAsana(outsider);
  expect(hidden.status()).toBe(404);
  expect(await json(hidden)).toEqual({ error: "notFound" });
  const bad = await sendAsana(outsider, { memoId: "not-a-uuid" });
  expect(bad.status()).toBe(400);

  const lonely = await seedMemo({ team: "growth", lang: "fr", title: "tm sans décideur", author_id: ids[AUTHOR] });
  const author = await as(browser, AUTHOR);
  const noDecider = await sendAsana(author, { memoId: lonely });
  expect(noDecider.status()).toBe(409);
  expect(await json(noDecider)).toEqual({ error: "needDecider" });

  // Signed out: the proxy answers before the route.
  const anon = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const res = await anon.request.post("/api/asana", { data: { memoId } });
  expect(res.status()).toBe(401);
  await Promise.all([reader, outsider, author].map((p) => p.context().close()));
  await anon.close();
});

test("two sends at the same time (author and decision maker) leave one task", async ({ browser }) => {
  await admin().from("memos").update({ asana_task_gid: null }).eq("id", memoId);
  const author = await as(browser, AUTHOR);
  const decider = await as(browser, DECIDER);
  seen.length = 0;
  const firstNew = nextGid;
  // Both requests read the memo (no task yet) and create a task before either saves.
  holdCreates = 2;
  const [a, b] = await Promise.all([sendAsana(author), sendAsana(decider)]);
  expect(a.status()).toBe(200);
  expect(b.status()).toBe(200);
  const [outA, outB] = [await json(a), await json(b)];
  // Both answer with the task linked to the memo.
  const stored = await storedGid();
  expect(outA.gid).toBe(stored);
  expect(outB.gid).toBe(stored);
  expect(outA.url).toBe(`https://app.asana.com/0/${PROJECT}/${stored}`);
  expect(seen.filter((r) => r.method === "POST")).toHaveLength(2);
  // The task that lost the race was removed from Asana: one task left for this send.
  const deleted = seen.filter((r) => r.method === "DELETE");
  expect(deleted).toHaveLength(1);
  expect(deleted[0].path).not.toBe(`/api/1.0/tasks/${stored}`);
  expect(deleted[0].auth).toBe(`Bearer ${TOKEN}`);
  expect([...tasks.keys()].filter((g) => g !== FOREIGN_TASK && Number(g) >= firstNew)).toEqual([stored]);

  // Sending again updates that task: still one.
  seen.length = 0;
  expect(await json(await sendAsana(decider))).toMatchObject({ gid: stored, updated: true });
  expect(seen.map((r) => r.method)).toEqual(["GET", "PUT"]);
  await Promise.all([author, decider].map((p) => p.context().close()));
});
