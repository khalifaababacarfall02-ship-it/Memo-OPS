// "Connecter Google Agenda" end to end, against a local stand-in for Google
// (consent screen, token endpoint, Calendar API v3). Needs the app started with
//   GOOGLE_CLIENT_ID=e2e-google-client GOOGLE_CLIENT_SECRET=e2e-google-secret
//   GOOGLE_TOKEN_KEY=<32 bytes, base64>
//   GOOGLE_AUTH_BASE / GOOGLE_TOKEN_BASE / GOOGLE_API_BASE=http://127.0.0.1:$E2E_GOOGLE_MOCK_PORT
// and E2E_GOOGLE_MOCK_PORT set here: the spec starts the mock.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import { content } from "../src/lib/content";
import { admin, cleanupUser, ensureUser, signIn } from "./support";

const fr = content.fr.ui;
const PORT = Number(process.env.E2E_GOOGLE_MOCK_PORT ?? 0);
const CLIENT_ID = "e2e-google-client";
const CLIENT_SECRET = "e2e-google-secret";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const USER = "gg-user@boxhero.test";
const GOOGLE_EMAIL = "Gg.User@Gmail.test";
const stamp = Date.now().toString(36);

test.describe.configure({ mode: "serial" });
test.skip(!PORT, "set E2E_GOOGLE_MOCK_PORT (and start the app with the matching GOOGLE_* env)");

// ---------- the Google stand-in ----------

const google = {
  /** What the consent screen answers: yes, no, or yes without the calendar box. */
  answer: "allow" as "allow" | "deny" | "noCalendar",
  codes: new Map<string, { redirectUri: string; scope: string }>(),
  refreshTokens: new Set<string>(),
  revoked: new Set<string>(),
  consentRequests: [] as URLSearchParams[],
  n: 0,
};
let server: Server | undefined;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (email: string) => `${b64({ alg: "RS256" })}.${b64({ iss: "https://accounts.google.com", email })}.c2ln`;

function at(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function events() {
  return [
    {
      id: `g1${stamp}`,
      iCalUID: `g1-${stamp}@google.com`,
      status: "confirmed",
      summary: "Point Google e2e",
      start: { dateTime: at(1, 9) },
      end: { dateTime: at(1, 10) },
      hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
      organizer: { email: USER },
      attendees: [
        { email: USER, responseStatus: "accepted" },
        { email: "Guest.G@gmail.test", responseStatus: "accepted" },
        { email: "no.thanks@gmail.test", responseStatus: "declined" },
        { email: "room-1@resource.calendar.google.com", resource: true },
      ],
    },
    {
      id: `g2${stamp}_20990101T140000Z`,
      iCalUID: `weekly-${stamp}@google.com`,
      recurringEventId: `g2${stamp}`,
      originalStartTime: { dateTime: at(2, 14) },
      status: "confirmed",
      summary: "Weekly Google e2e",
      start: { dateTime: at(2, 14) },
      end: { dateTime: at(2, 15) },
    },
    { id: `g3${stamp}`, iCalUID: `g3-${stamp}@google.com`, status: "cancelled", summary: "Annulé e2e", start: { dateTime: at(1, 11) } },
  ];
}

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return new URLSearchParams(raw);
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  // The consent screen: answers at once, like a person clicking "Continue".
  if (req.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
    const q = url.searchParams;
    google.consentRequests.push(q);
    const redirectUri = q.get("redirect_uri") ?? "";
    if (q.get("client_id") !== CLIENT_ID || q.get("response_type") !== "code" || !redirectUri.startsWith("http")) {
      res.writeHead(400).end("bad consent request");
      return;
    }
    const back = new URL(redirectUri);
    back.searchParams.set("state", q.get("state") ?? "");
    if (google.answer === "deny") {
      back.searchParams.set("error", "access_denied");
    } else {
      const code = `code-${++google.n}`;
      const scope = google.answer === "noCalendar" ? "openid https://www.googleapis.com/auth/userinfo.email" : `openid https://www.googleapis.com/auth/userinfo.email ${CALENDAR_SCOPE}`;
      google.codes.set(code, { redirectUri, scope });
      back.searchParams.set("code", code);
    }
    res.writeHead(302, { Location: back.toString() }).end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/token") {
    const p = await body(req);
    if (p.get("client_id") !== CLIENT_ID || p.get("client_secret") !== CLIENT_SECRET) return json(res, 401, { error: "invalid_client" });
    if (p.get("grant_type") === "authorization_code") {
      const code = google.codes.get(p.get("code") ?? "");
      google.codes.delete(p.get("code") ?? "");
      if (!code || code.redirectUri !== p.get("redirect_uri")) return json(res, 400, { error: "invalid_grant" });
      const refresh = `rt-${google.n}-${stamp}`;
      google.refreshTokens.add(refresh);
      return json(res, 200, { access_token: `at-${refresh}`, expires_in: 3599, refresh_token: refresh, scope: code.scope, id_token: idToken(GOOGLE_EMAIL) });
    }
    if (p.get("grant_type") === "refresh_token") {
      const refresh = p.get("refresh_token") ?? "";
      if (!google.refreshTokens.has(refresh) || google.revoked.has(refresh)) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: `at-${refresh}`, expires_in: 3599, scope: CALENDAR_SCOPE });
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  if (req.method === "POST" && url.pathname === "/revoke") {
    google.revoked.add((await body(req)).get("token") ?? "");
    return json(res, 200, {});
  }
  if (req.method === "GET" && url.pathname === "/calendar/v3/calendars/primary/events") {
    const refresh = (req.headers.authorization ?? "").replace(/^Bearer at-/, "");
    if (!google.refreshTokens.has(refresh) || google.revoked.has(refresh)) {
      return json(res, 401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    }
    const q = url.searchParams;
    if (q.get("singleEvents") !== "true" || !q.get("timeMin") || !q.get("timeMax")) return json(res, 400, { error: { status: "INVALID_ARGUMENT" } });
    return json(res, 200, { items: events() });
  }
  res.writeHead(404).end();
}

let userId = "";

test.beforeAll(async () => {
  server = createServer((req, res) => {
    handle(req, res).catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((r) => server!.listen(PORT, "127.0.0.1", r));
  ({ id: userId } = await ensureUser(USER, { fullName: "Gaby Google", teams: ["ops"] }));
  await admin().from("google_connections").delete().eq("user_id", userId);
  await admin().from("calendar_links").delete().eq("user_id", userId);
});

test.afterAll(async () => {
  await admin().from("google_connections").delete().eq("user_id", userId);
  await cleanupUser(USER);
  await new Promise((r) => server?.close(r));
});

test("one click: Google's screen, then the next calls are on the home page", async ({ page }) => {
  await signIn(page, USER, "/");
  const connect = page.locator("#googleConnect");
  await expect(connect).toHaveText(fr.googleConnect);
  await connect.click();

  // Back from Google: a notice, then the address loses its ?google=….
  await expect(page.locator("#googleNotice")).toHaveText(fr.googleNotice_connected);
  await expect(page).toHaveURL("/");
  const asked = google.consentRequests.at(-1)!;
  expect(asked.get("redirect_uri")).toBe(new URL("/api/google/callback", page.url()).toString());
  expect(asked.get("scope")?.split(" ")).toContain(CALENDAR_SCOPE);
  expect(asked.get("access_type")).toBe("offline");
  expect(asked.get("login_hint")).toBe(USER);

  // The calls, from Google: the cancelled one is left out, the video link is there.
  await expect(page.locator(".calls-src")).toContainText("Google Agenda · gg.user@gmail.test");
  const rows = page.locator("#callsList .calls-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Point Google e2e");
  await expect(rows.nth(0)).toContainText("guest.g");
  await expect(rows.nth(0)).not.toContainText("no.thanks");
  await expect(rows.nth(0).locator(".calls-join")).toHaveAttribute("href", "https://meet.google.com/aaa-bbbb-ccc");
  await expect(rows.nth(1)).toContainText("Weekly Google e2e");
  await expect(page.locator("#calConnect, #googleConnect")).toHaveCount(0);

  // Stored encrypted: the refresh token itself is nowhere in the row.
  const { data } = await admin().from("google_connections").select("google_email, refresh_token, scope").eq("user_id", userId).single();
  expect(data?.google_email).toBe("gg.user@gmail.test");
  expect(data?.refresh_token).toMatch(/^v1\./);
  expect(data?.refresh_token).not.toContain("rt-");
  expect(data?.scope).toContain(CALENDAR_SCOPE);

  // A reload: no notice any more, still connected.
  await page.reload();
  await expect(page.locator("#googleNotice")).toHaveCount(0);
  await expect(rows).toHaveCount(2);
});

test("prepare the memo of a Google call: the people of the call come with it", async ({ page }) => {
  await signIn(page, USER, "/");
  const row = page.locator("#callsList .calls-row", { hasText: "Point Google e2e" });
  await row.getByRole("button", { name: fr.callsPrepare }).click();
  await expect(page).toHaveURL(/\/memos\/[0-9a-f-]{36}$/);
  const memoId = page.url().split("/").at(-1)!;
  const { data: people } = await admin().from("memo_participants").select("email").eq("memo_id", memoId);
  expect(people?.map((p) => p.email).sort()).toEqual(["guest.g@gmail.test"]);
  const { data: call } = await admin().from("memo_calls").select("event_id").eq("memo_id", memoId).single();
  expect(call?.event_id).toBe(`g1-${stamp}@google.com`);

  // Back home: the call now opens its memo.
  await page.goto("/");
  await expect(page.locator("#callsList .calls-row", { hasText: "Point Google e2e" }).locator(".calls-open")).toHaveAttribute(
    "href",
    `/memos/${memoId}`,
  );
});

test("access revoked on Google's side: the home page asks to reconnect", async ({ page }) => {
  for (const t of google.refreshTokens) google.revoked.add(t);
  await signIn(page, USER, "/");
  await expect(page.locator(".calls-connect")).toContainText(fr.googleBrokenNote);
  await expect(page.locator("#googleConnect")).toHaveText(fr.googleReconnect);
  // Reconnecting gives a new token, and the calls come back.
  await page.locator("#googleConnect").click();
  await expect(page.locator("#googleNotice")).toHaveText(fr.googleNotice_connected);
  await expect(page.locator("#callsList .calls-row")).toHaveCount(2);
});

test("disconnect: the token is revoked at Google and deleted here", async ({ page }) => {
  await signIn(page, USER, "/");
  const before = new Set(google.revoked);
  await page.locator("#googleDisconnect").click();
  await expect(page.locator(".toast")).toHaveText(fr.googleDisconnected);
  await expect(page.locator("#googleConnect")).toHaveText(fr.googleConnect);
  expect([...google.revoked].filter((t) => !before.has(t))).toHaveLength(1);
  const { count } = await admin().from("google_connections").select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  expect(count).toBe(0);
});

test("said no, or unticked the calendar, on Google's screen: a clear notice, nothing stored", async ({ page }) => {
  await signIn(page, USER, "/");
  google.answer = "deny";
  await page.locator("#googleConnect").click();
  await expect(page.locator("#googleNotice")).toHaveText(fr.googleNotice_denied);
  google.answer = "noCalendar";
  await page.locator("#googleConnect").click();
  await expect(page.locator("#googleNotice")).toHaveText(fr.googleNotice_scope);
  google.answer = "allow";
  const { count } = await admin().from("google_connections").select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  expect(count).toBe(0);
});

test("a callback that did not start here is refused; signed out, connect asks to sign in", async ({ page }) => {
  await signIn(page, USER, "/");
  await page.goto("/api/google/callback?code=code-forged&state=forged-state");
  await expect(page.locator("#googleNotice")).toHaveText(fr.googleNotice_error);
  const { count } = await admin().from("google_connections").select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  expect(count).toBe(0);

  await page.context().clearCookies();
  await page.goto("/api/google/connect");
  await expect(page).toHaveURL(/\/login/);
});
