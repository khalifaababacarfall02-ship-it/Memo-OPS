// The POST /api/slack flow with a fake Supabase (what RLS lets the viewer read)
// and a fake Slack API.
import { describe, expect, it, vi } from "vitest";
import { SlackError } from "./client";
import { type SlackSendDeps, handleSendToSlack } from "./send";

vi.mock("server-only", () => ({}));

const MEMO_ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const ORIGIN = "https://memo.boxhero.test";

interface Db {
  memo: Record<string, unknown> | null;
  participants: string[];
  startsAt: string | null;
}

function fakeSupabase(db: Db) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, value: unknown) {
              if (table === "memo_participants") {
                return Promise.resolve({ data: db.participants.map((email) => ({ email })), error: null });
              }
              return {
                maybeSingle: async () => {
                  if (table === "memos") return { data: db.memo && db.memo.id === value ? db.memo : null, error: null };
                  if (table === "memo_calls") return { data: db.startsAt ? { starts_at: db.startsAt } : null, error: null };
                  throw new Error(`unexpected table ${table}`);
                },
              };
            },
          };
        },
      };
    },
  };
}

function setup(over: Partial<Db> = {}, viewer: Partial<{ id: string; email: string; isAdmin: boolean; fullName: string }> | null = {}) {
  const db: Db = {
    memo: {
      id: MEMO_ID,
      title: "Retours <clients> & délais",
      lang: "fr",
      team: "ops",
      author_id: "author",
      decider_id: "decider",
      author: { full_name: "Ali Auteur", email: "ali@gmail.com" },
      decider: { full_name: "Mattéo", email: "Matteo@Gmail.com" },
    },
    participants: ["lea@proton.me", "ali@gmail.com", "nobody@gmail.com", "matteo@gmail.com"],
    startsAt: "2026-10-05T08:30:00.000Z",
    ...over,
  };
  const slackUsers: Record<string, string> = { "lea@proton.me": "U1", "matteo@gmail.com": "U2" };
  const posts: { userId: string; text: string; blocks: unknown[] }[] = [];
  const slack = {
    lookupUserByEmail: vi.fn(async (email: string) => slackUsers[email] ?? null),
    postDirectMessage: vi.fn(async (userId: string, m: { text: string; blocks: unknown[] }) => {
      posts.push({ userId, ...m });
    }),
  };
  const deps: SlackSendDeps = {
    getViewer: async () =>
      viewer === null ? null : { id: "author", email: "ali@gmail.com", isAdmin: false, fullName: "Ali Auteur", ...viewer },
    createClient: async () => fakeSupabase(db) as never,
    getOrigin: async () => ORIGIN,
    isEnabled: () => true,
    slack,
  };
  return { db, deps, slack, posts };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/slack", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("handleSendToSlack", () => {
  it("DMs every person of the call and the decision maker once, except the sender", async () => {
    const { deps, posts, slack } = setup();
    const res = await handleSendToSlack(post({ memoId: MEMO_ID }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: ["lea@proton.me", "matteo@gmail.com"], missing: ["nobody@gmail.com"], failed: [] });
    expect(slack.lookupUserByEmail).toHaveBeenCalledTimes(3);
    expect(posts.map((p) => p.userId)).toEqual(["U1", "U2"]);
    const section = JSON.stringify(posts[0].blocks);
    expect(section).toContain("Retours &lt;clients&gt; &amp; délais");
    expect(section).toContain(`${ORIGIN}/memos/${MEMO_ID}`);
    expect(section).toContain("<!date^");
    expect(posts[0].text).toBe("Ali Auteur te partage un mémo pour l’appel : Retours <clients> & délais");
  });

  it("refuses signed-out people, when Slack is off, bad bodies, unknown memos and readers", async () => {
    expect((await handleSendToSlack(post({ memoId: MEMO_ID }), setup({}, null).deps)).status).toBe(401);
    const off = setup();
    off.deps.isEnabled = () => false;
    const offRes = await handleSendToSlack(post({ memoId: MEMO_ID }), off.deps);
    expect(offRes.status).toBe(503);
    expect(await offRes.json()).toEqual({ error: "notConfigured" });
    expect((await handleSendToSlack(post("{nope"), setup().deps)).status).toBe(400);
    expect((await handleSendToSlack(post({ memoId: "x" }), setup().deps)).status).toBe(400);
    expect((await handleSendToSlack(post({ memoId: MEMO_ID }), setup({ memo: null }).deps)).status).toBe(404);
    const reader = setup({}, { id: "reader", email: "rémi@gmail.com" });
    expect((await handleSendToSlack(post({ memoId: MEMO_ID }), reader.deps)).status).toBe(403);
    expect(reader.slack.lookupUserByEmail).not.toHaveBeenCalled();
  });

  it("lets the decision maker and admins share it too", async () => {
    const decider = setup({}, { id: "decider", email: "matteo@gmail.com" });
    const res = await handleSendToSlack(post({ memoId: MEMO_ID }), decider.deps);
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toEqual(["lea@proton.me"]);
    const adminRes = await handleSendToSlack(post({ memoId: MEMO_ID }), setup({}, { id: "boss", email: "boss@gmail.com", isAdmin: true }).deps);
    expect(adminRes.status).toBe(200);
  });

  it("says when there is nobody to send to", async () => {
    const res = await handleSendToSlack(
      post({ memoId: MEMO_ID }),
      setup({ participants: ["ali@gmail.com"], memo: { ...setup().db.memo, decider_id: null, decider: null } }).deps,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "nobody" });
  });

  it("stops at once when Slack refuses the token, and reports other failures per person", async () => {
    const bad = setup();
    bad.slack.lookupUserByEmail.mockRejectedValue(new SlackError("invalid_auth", 200));
    const res = await handleSendToSlack(post({ memoId: MEMO_ID }), bad.deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "slackAuth" });
    expect(bad.slack.lookupUserByEmail).toHaveBeenCalledTimes(1);

    const flaky = setup();
    flaky.slack.postDirectMessage.mockRejectedValueOnce(new SlackError("channel_not_found", 200));
    const res2 = await handleSendToSlack(post({ memoId: MEMO_ID }), flaky.deps);
    expect(await res2.json()).toEqual({ sent: ["matteo@gmail.com"], missing: ["nobody@gmail.com"], failed: ["lea@proton.me"] });
  });
});
