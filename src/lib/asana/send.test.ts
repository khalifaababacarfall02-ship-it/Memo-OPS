// The POST /api/asana flow with a fake Supabase (RLS outcomes simulated) and
// a fake Asana API; client.test.ts covers the HTTP layer itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "@/lib/content";
import { asanaTaskName, asanaTaskNotes } from "@/lib/memo/export";
import { normalizeContent } from "@/lib/memo/model";
import { AsanaError, type AsanaTask, type TaskFields } from "./client";
import { type AsanaApi, type SendDeps, handleSendToAsana } from "./send";

const MEMO_ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const PROJECT = "7000";
const ORIGIN = "https://memo.boxhero.test";
const TOKEN = "1/123:super-secret";

const content = {
  kind: "memo",
  author: "Tom",
  meta: ["Léa", "Tom", "lundi", "Retours"],
  s: ["Pourquoi", "Quoi", "Comment", "Maintenant"],
  acts: [],
  needs: [],
  res: "",
  qs: [{ id: "q1", q: "On y va ?" }],
};

interface Row {
  id: string;
  team: string;
  lang: string;
  title: string;
  content: unknown;
  author_id: string;
  decider_id: string | null;
  asana_task_gid: string | null;
  memo_answers: { question_id: string; answer: string }[];
  decider: { email: string; asana_user_gid: string | null } | null;
}

function baseRow(): Row {
  return {
    id: MEMO_ID,
    team: "ops",
    lang: "fr",
    title: "Corriger les retours",
    content,
    author_id: "author",
    decider_id: "decider",
    asana_task_gid: null,
    memo_answers: [{ question_id: "q1", answer: "Oui" }],
    decider: { email: "lea@boxhero.test", asana_user_gid: null },
  };
}

/** What the fake database does: the memo visible through RLS, and how the gid update ends. */
interface Db {
  row: Row | null;
  loadError?: { code: string; message: string };
  updateResult?: { data: unknown[] | null; error: { code: string; message: string } | null };
  updates: { patch: Record<string, unknown>; id: unknown; select: string }[];
  selects: string[];
}
let db: Db;

function fakeSupabase() {
  return {
    from(table: string) {
      expect(table).toBe("memos");
      return {
        select(columns: string) {
          db.selects.push(columns);
          return {
            eq(col: string, value: unknown) {
              expect(col).toBe("id");
              return {
                maybeSingle: async () =>
                  db.loadError
                    ? { data: null, error: db.loadError }
                    : { data: db.row && db.row.id === value ? db.row : null, error: null },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(col: string, id: unknown) {
              expect(col).toBe("id");
              return {
                select: async (select: string) => {
                  db.updates.push({ patch, id, select });
                  return db.updateResult ?? { data: [{ id }], error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

/** Fake Asana: tasks by gid with their project; records every call. */
let tasks: Map<string, { project: string }>;
let asanaCalls: { op: string; gid?: string; fields: TaskFields & { projects?: string[] } }[];
let nextGid: number;
let failWith: AsanaError | null;
let rejectAssignee: boolean;

const fakeAsana: AsanaApi = {
  async getTask(gid) {
    asanaCalls.push({ op: "get", gid, fields: {} });
    if (failWith) throw failWith;
    const t = tasks.get(gid);
    if (!t) throw new AsanaError("http", 404, ["task: Not a recognized ID"]);
    return { gid, memberships: [{ project: { gid: t.project } }], permalink_url: `https://app.asana.com/0/${t.project}/${gid}` };
  },
  async createTask(fields) {
    asanaCalls.push({ op: "create", fields });
    if (failWith) throw failWith;
    if (rejectAssignee && fields.assignee) throw new AsanaError("http", 400, ["assignee: Not a recognized ID: <email>"]);
    const gid = String(nextGid++);
    tasks.set(gid, { project: fields.projects[0] });
    return { gid, permalink_url: `https://app.asana.com/0/${fields.projects[0]}/${gid}` } satisfies AsanaTask;
  },
  async updateTask(gid, fields) {
    asanaCalls.push({ op: "update", gid, fields });
    if (failWith) throw failWith;
    if (rejectAssignee && fields.assignee) throw new AsanaError("http", 400, ["assignee: Not a recognized ID: <email>"]);
    return { gid, permalink_url: `https://app.asana.com/0/${PROJECT}/${gid}` };
  },
};

let viewer: { id: string; isAdmin: boolean } | null;
let enabled: boolean;

const deps = (): SendDeps => ({
  getViewer: async () => viewer,
  createClient: async () => fakeSupabase() as never,
  getOrigin: async () => ORIGIN,
  isEnabled: () => enabled,
  projectGid: () => PROJECT,
  asana: fakeAsana,
});

const post = (body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
  handleSendToAsana(
    new Request("http://localhost/api/asana", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps(),
  );

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error: code });
}

beforeEach(() => {
  db = { row: baseRow(), updates: [], selects: [] };
  tasks = new Map();
  asanaCalls = [];
  nextGid = 1200;
  failWith = null;
  rejectAssignee = false;
  viewer = { id: "author", isAdmin: false };
  enabled = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/asana: guards", () => {
  it("401 when signed out, before anything else", async () => {
    viewer = null;
    await expectError(await post({ memoId: MEMO_ID }), 401, "unauthorized");
    expect(asanaCalls).toHaveLength(0);
  });
  it("404 when Asana is not configured", async () => {
    enabled = false;
    await expectError(await post({ memoId: MEMO_ID }), 404, "notConfigured");
  });
  it("400 on a bad body or a non-JSON request", async () => {
    await expectError(await post({ memoId: "nope" }), 400, "badRequest");
    await expectError(await post("{not json"), 400, "badRequest");
    await expectError(await post(`memoId=${MEMO_ID}`, { "Content-Type": "text/plain" }), 400, "badRequest");
    await expectError(await post({ memoId: MEMO_ID, pad: "x".repeat(5000) }), 400, "badRequest");
  });
  it("404 when RLS hides the memo (or it does not exist)", async () => {
    db.row = null;
    await expectError(await post({ memoId: MEMO_ID }), 404, "notFound");
  });
  it("500 when the memo cannot be loaded", async () => {
    db.loadError = { code: "57014", message: "canceling statement due to statement timeout" };
    await expectError(await post({ memoId: MEMO_ID }), 500, "serverError");
  });
  it("403 for a reader who is neither author, decision maker nor admin", async () => {
    viewer = { id: "member", isAdmin: false };
    await expectError(await post({ memoId: MEMO_ID }), 403, "forbidden");
    expect(asanaCalls).toHaveLength(0);
  });
  it("409 needDecider without a decision maker", async () => {
    db.row = { ...baseRow(), decider_id: null, decider: null };
    await expectError(await post({ memoId: MEMO_ID }), 409, "needDecider");
    expect(asanaCalls).toHaveLength(0);
  });
});

describe("POST /api/asana: create and update", () => {
  it("creates the task in the Memos project, assigned to the decision maker, and saves its gid", async () => {
    const res = await post({ memoId: MEMO_ID });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({
      gid: "1200",
      url: `https://app.asana.com/0/${PROJECT}/1200`,
      assigned: true,
      updated: false,
    });
    const m = {
      team: "ops" as const,
      lang: "fr" as const,
      title: "Corriger les retours",
      content: normalizeContent("ops", content),
      answers: { q1: "Oui" },
    };
    expect(asanaCalls).toEqual([
      {
        op: "create",
        fields: {
          name: asanaTaskName(m),
          html_notes: asanaTaskNotes(m, { link: { href: `${ORIGIN}/memos/${MEMO_ID}`, label: ui("fr").openInApp } }),
          assignee: "lea@boxhero.test",
          projects: [PROJECT],
        },
      },
    ]);
    expect(asanaCalls[0].fields.html_notes).toContain("Oui");
    // Only asana_task_gid is written (the guard refuses anything else from non-authors).
    expect(db.updates).toEqual([{ patch: { asana_task_gid: "1200" }, id: MEMO_ID, select: "id" }]);
  });

  it("assigns to the decision maker's Asana user gid when set", async () => {
    db.row = { ...baseRow(), decider: { email: "lea@boxhero.test", asana_user_gid: "555" } };
    await post({ memoId: MEMO_ID });
    expect(asanaCalls[0].fields.assignee).toBe("555");
  });

  it("works for the decision maker and for an admin", async () => {
    viewer = { id: "decider", isAdmin: false };
    expect((await post({ memoId: MEMO_ID })).status).toBe(200);
    viewer = { id: "someone", isAdmin: true };
    db.row = baseRow();
    expect((await post({ memoId: MEMO_ID })).status).toBe(200);
  });

  it("updates the existing task when it is in the Memos project, without rewriting the gid", async () => {
    tasks.set("900", { project: PROJECT });
    db.row = { ...baseRow(), asana_task_gid: "900" };
    const res = await post({ memoId: MEMO_ID });
    expect(await res.json()).toEqual({
      gid: "900",
      url: `https://app.asana.com/0/${PROJECT}/900`,
      assigned: true,
      updated: true,
    });
    expect(asanaCalls.map((c) => [c.op, c.gid])).toEqual([
      ["get", "900"],
      ["update", "900"],
    ]);
    expect(asanaCalls[1].fields).not.toHaveProperty("projects");
    expect(db.updates).toEqual([]);
  });

  it("never touches a task outside the Memos project: creates a new one instead", async () => {
    tasks.set("666", { project: "someone-elses-project" });
    db.row = { ...baseRow(), asana_task_gid: "666" };
    const body = await (await post({ memoId: MEMO_ID })).json();
    expect(body).toMatchObject({ gid: "1200", updated: false });
    expect(asanaCalls.map((c) => c.op)).toEqual(["get", "create"]);
    expect(db.updates[0].patch).toEqual({ asana_task_gid: "1200" });
  });

  it("creates a new task when the stored one was deleted", async () => {
    db.row = { ...baseRow(), asana_task_gid: "901" };
    const body = await (await post({ memoId: MEMO_ID })).json();
    expect(body).toMatchObject({ gid: "1200", updated: false });
  });

  it("does not create a duplicate when Asana fails while checking the stored task", async () => {
    db.row = { ...baseRow(), asana_task_gid: "902" };
    failWith = new AsanaError("http", 500, ["Server Error"]);
    await expectError(await post({ memoId: MEMO_ID }), 502, "asanaError");
    expect(asanaCalls.map((c) => c.op)).toEqual(["get"]);
    expect(db.updates).toEqual([]);
  });

  it("retries once without assignee when Asana refuses the decision maker", async () => {
    rejectAssignee = true;
    const body = await (await post({ memoId: MEMO_ID })).json();
    expect(body).toMatchObject({ gid: "1200", assigned: false, updated: false });
    expect(asanaCalls.map((c) => [c.op, c.fields.assignee ?? null])).toEqual([
      ["create", "lea@boxhero.test"],
      ["create", null],
    ]);
  });

  it("502 with a generic code when Asana fails, nothing saved, no internals leaked", async () => {
    failWith = new AsanaError("http", 401, [`Not Authorized ${TOKEN}`]);
    const res = await post({ memoId: MEMO_ID });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "asanaError" }));
    expect(db.updates).toEqual([]);
  });

  it("502 on a timeout", async () => {
    failWith = new AsanaError("timeout");
    await expectError(await post({ memoId: MEMO_ID }), 502, "asanaError");
  });

  it("500 saveError when RLS refuses to store the gid", async () => {
    db.updateResult = { data: [], error: null };
    await expectError(await post({ memoId: MEMO_ID }), 500, "saveError");
    db.updateResult = { data: null, error: { code: "42501", message: "only the author can edit this memo" } };
    await expectError(await post({ memoId: MEMO_ID }), 500, "saveError");
  });

  it("reads the memo with its answers and decision maker through the viewer's client", async () => {
    await post({ memoId: MEMO_ID });
    expect(db.selects[0]).toContain("memo_answers(question_id, answer)");
    expect(db.selects[0]).toContain("decider:profiles!memos_decider_id_fkey(email, asana_user_gid)");
  });
});
