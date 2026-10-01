import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASANA_API_BASE, AsanaError, apiBase, createTask, deleteTask, getTask, updateTask } from "./client";

const TOKEN = "1/123456:secret-token-value";

type Call = { url: string; init: RequestInit };
let calls: Call[];

function stubFetch(respond: (call: Call) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return respond(call);
    }),
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("ASANA_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("ASANA_API_BASE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("requests", () => {
  it("creates a task with the bearer token, the data envelope and permalink_url", async () => {
    stubFetch(() => json(201, { data: { gid: "42", permalink_url: "https://app.asana.com/0/7/42" } }));
    const task = await createTask({ name: "MÉMO : x", html_notes: "<body>x</body>", assignee: "a@b.c", projects: ["7"] });
    expect(task).toEqual({ gid: "42", permalink_url: "https://app.asana.com/0/7/42" });
    const [{ url, init }] = calls;
    expect(url).toBe(`${ASANA_API_BASE}/tasks?opt_fields=permalink_url`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      data: { name: "MÉMO : x", html_notes: "<body>x</body>", assignee: "a@b.c", projects: ["7"] },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error");
  });

  it("omits the assignee when there is none (null would unassign)", async () => {
    stubFetch(() => json(200, { data: { gid: "42" } }));
    await updateTask("42", { name: "n", html_notes: "<body/>", assignee: null });
    const [{ url, init }] = calls;
    expect(url).toBe(`${ASANA_API_BASE}/tasks/42?opt_fields=permalink_url`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ data: { name: "n", html_notes: "<body/>" } });
  });

  it("reads a task with its projects", async () => {
    stubFetch(() => json(200, { data: { gid: "42", memberships: [{ project: { gid: "7" } }] } }));
    const task = await getTask("42");
    expect(task.memberships?.[0].project?.gid).toBe("7");
    expect(calls[0].url).toBe(`${ASANA_API_BASE}/tasks/42?opt_fields=memberships.project.gid%2Cpermalink_url`);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("deletes a task (Asana answers an empty data object)", async () => {
    stubFetch(() => json(200, { data: {} }));
    await expect(deleteTask("42")).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${ASANA_API_BASE}/tasks/42`);
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].init.body).toBeUndefined();
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    stubFetch(() => json(404, { errors: [{ message: "task: Unknown object: 42" }] }));
    await expect(deleteTask("42")).rejects.toMatchObject({ kind: "http", status: 404 });
  });

  it("refuses non-numeric gids before any request", async () => {
    stubFetch(() => json(200, { data: { gid: "1" } }));
    await expect(getTask("../users/me")).rejects.toMatchObject({ kind: "invalid" });
    await expect(updateTask("1?x=1", {})).rejects.toMatchObject({ kind: "invalid" });
    await expect(deleteTask("1/stories")).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });
});

describe("errors", () => {
  it("carries the status and Asana's messages, never the token", async () => {
    stubFetch(() =>
      json(400, { errors: [{ message: "assignee: Not a recognized ID: x@y.z", help: "…" }, { nope: 1 }] }),
    );
    const err = await createTask({ name: "n", projects: ["7"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AsanaError);
    expect(err).toMatchObject({ kind: "http", status: 400, messages: ["assignee: Not a recognized ID: x@y.z"] });
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it("handles a non-JSON error page", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(getTask("1")).rejects.toMatchObject({ kind: "http", status: 502, messages: [] });
  });

  it("rejects a 2xx without a task", async () => {
    stubFetch(() => json(200, { data: null }));
    await expect(getTask("1")).rejects.toMatchObject({ kind: "invalid", status: 200 });
    stubFetch(() => new Response("not json", { status: 200 }));
    await expect(getTask("1")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("reports timeouts and network failures", async () => {
    stubFetch(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(getTask("1")).rejects.toMatchObject({ kind: "timeout", status: 0 });
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(getTask("1")).rejects.toMatchObject({ kind: "network", status: 0 });
  });

  it("aborts a request that takes too long (10 s)", async () => {
    // Fake timers do not drive AbortSignal.timeout: shorten it instead.
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const asked: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      asked.push(ms);
      return timeout(20);
    });
    stubFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(getTask("1")).rejects.toMatchObject({ kind: "timeout" });
    expect(asked).toEqual([10_000]);
  });

  it("needs a token", async () => {
    vi.stubEnv("ASANA_ACCESS_TOKEN", "");
    stubFetch(() => json(200, { data: { gid: "1" } }));
    await expect(getTask("1")).rejects.toMatchObject({ kind: "config" });
    expect(calls).toHaveLength(0);
  });
});

describe("apiBase", () => {
  it("defaults to Asana", () => {
    expect(apiBase(undefined)).toBe(ASANA_API_BASE);
    expect(apiBase("  ")).toBe(ASANA_API_BASE);
  });
  it("accepts https, or http to this machine (test mocks)", () => {
    expect(apiBase("https://asana.example.com/api/1.0/")).toBe("https://asana.example.com/api/1.0");
    expect(apiBase("http://127.0.0.1:4999")).toBe("http://127.0.0.1:4999");
    expect(apiBase("http://localhost:4999/api/1.0")).toBe("http://localhost:4999/api/1.0");
  });
  it.each(["http://evil.example.com", "ftp://localhost", "not a url", "https://u:p@x.com", "https://x.com/?a=1"])(
    "refuses %s",
    (value) => {
      expect(() => apiBase(value)).toThrow(AsanaError);
    },
  );
  it("is used for requests", async () => {
    vi.stubEnv("ASANA_API_BASE", "http://127.0.0.1:4999/api/1.0");
    stubFetch(() => json(200, { data: { gid: "1" } }));
    await getTask("1");
    expect(calls[0].url.startsWith("http://127.0.0.1:4999/api/1.0/tasks/1?")).toBe(true);
  });
});
