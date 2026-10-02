// Calls round end to end against the local stack: invitations (admins, /team),
// the first sign-in (/welcome), the people of a memo's call (who then read it),
// "Send on Slack" (a local mock of slack.com/api) and the home page calendar
// (a local iCal server standing in for Google Calendar). Needs the app started with
//   SLACK_BOT_TOKEN=xoxb-e2e-dummy SLACK_API_BASE=http://127.0.0.1:$E2E_SLACK_MOCK_PORT/api
//   CALENDAR_TEST_HOSTS=localhost:$E2E_CAL_MOCK_PORT
//   NODE_EXTRA_CA_CERTS=<a bundle with E2E_CAL_TLS_CERT> (calendar links are https only)
// and E2E_SLACK_MOCK_PORT, E2E_CAL_MOCK_PORT, E2E_CAL_TLS_KEY / E2E_CAL_TLS_CERT (a
// self-signed certificate for localhost) set here: the spec starts both mocks.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { type Browser, type Page, expect, test } from "@playwright/test";
import { content } from "../src/lib/content";
import { admin, cleanupUser, ensureUser, seedMemo, signIn } from "./support";

const fr = content.fr.ui;
const SLACK_PORT = Number(process.env.E2E_SLACK_MOCK_PORT ?? 0);
const CAL_PORT = Number(process.env.E2E_CAL_MOCK_PORT ?? 0);
const CAL_TLS = { key: process.env.E2E_CAL_TLS_KEY ?? "", cert: process.env.E2E_CAL_TLS_CERT ?? "" };
const CAL_URL = `https://localhost:${CAL_PORT}`;
const SLACK_TOKEN = "xoxb-e2e-dummy";
const mailApi = process.env.MAIL_API_URL ?? "http://localhost:2501";

const stamp = Date.now().toString(36);
const ADMIN = "cl-admin@boxhero.test";
const AUTHOR = "cl-author@boxhero.test";
const GUEST = "cl-guest@boxhero.test";
// Invited from /team: outside the allowed domain, like the team's Gmail / Proton addresses.
const INVITED = `cl-new-${stamp}@gmail.test`;
const FREE = `cl-free-${stamp}@proton.test`;
const USERS = [ADMIN, AUTHOR, GUEST];

test.describe.configure({ mode: "serial" });
test.skip(
  !SLACK_PORT || !CAL_PORT || !CAL_TLS.key || !CAL_TLS.cert,
  "set E2E_SLACK_MOCK_PORT, E2E_CAL_MOCK_PORT, E2E_CAL_TLS_KEY/CERT (and start the app with the matching env)",
);

const ids: Record<string, string> = {};
let memoId = "";

// ---------- mocks ----------

const slackUsers: Record<string, string> = { [GUEST]: "UGUEST" };
const dms: { channel: string; text: string; blocks: unknown; auth: string | undefined }[] = [];
let calendar = "";
const servers: Server[] = [];

function ics(): string {
  const at = (days: number, hour: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//e2e//calls//EN",
    "BEGIN:VEVENT",
    `UID:cl-call-${stamp}@e2e`,
    `DTSTART:${at(2, 9)}`,
    `DTEND:${at(2, 10)}`,
    "SUMMARY:Point stock e2e",
    `ORGANIZER:mailto:${AUTHOR}`,
    `ATTENDEE;PARTSTAT=ACCEPTED;CN=Guest:mailto:${GUEST.toUpperCase()}`,
    "ATTENDEE;PARTSTAT=ACCEPTED:mailto:cl-outside@gmail.test",
    "END:VEVENT",
    "BEGIN:VEVENT",
    `UID:cl-later-${stamp}@e2e`,
    `DTSTART:${at(3, 14)}`,
    `DTEND:${at(3, 15)}`,
    "SUMMARY:Revue budget e2e",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

test.beforeAll(async () => {
  for (const e of USERS) await cleanupUser(e);
  ids.admin = (await ensureUser(ADMIN, { fullName: "Cléo Admin", teams: [], isAdmin: true })).id;
  ids.author = (await ensureUser(AUTHOR, { fullName: "Alix Auteur", teams: ["ops"], isAdmin: false })).id;
  ids.guest = (await ensureUser(GUEST, { fullName: "Gabi Invitée", teams: ["growth"], isAdmin: false })).id;
  memoId = await seedMemo({ team: "ops", lang: "fr", title: `cl memo ${stamp}`, author_id: ids.author });

  const slack = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const send = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.headers.authorization !== `Bearer ${SLACK_TOKEN}`) return send({ ok: false, error: "invalid_auth" });
      if (url.pathname === "/api/users.lookupByEmail") {
        const id = slackUsers[url.searchParams.get("email") ?? ""];
        return send(id ? { ok: true, user: { id } } : { ok: false, error: "users_not_found" });
      }
      if (url.pathname === "/api/chat.postMessage") {
        const body = JSON.parse(raw) as { channel: string; text: string; blocks: unknown };
        dms.push({ ...body, auth: req.headers.authorization });
        return send({ ok: true, channel: "D1", ts: "1.2" });
      }
      send({ ok: false, error: "unknown_method" });
    });
  });
  const serveCalendar = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url?.startsWith("/cal.ics")) {
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8" });
      res.end(calendar);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>not a calendar</html>");
  };
  const cal = createTlsServer({ key: readFileSync(CAL_TLS.key), cert: readFileSync(CAL_TLS.cert) }, serveCalendar);
  calendar = ics();
  await new Promise<void>((r) => slack.listen(SLACK_PORT, "127.0.0.1", r));
  await new Promise<void>((r) => cal.listen(CAL_PORT, "127.0.0.1", r));
  servers.push(slack, cal);
});

test.afterAll(async () => {
  const a = admin();
  for (const e of USERS) await cleanupUser(e);
  await a.from("invitations").delete().in("email", [INVITED, FREE]);
  for (const email of [INVITED, FREE]) {
    const { data } = await a.from("profiles").select("id").eq("email", email).maybeSingle();
    if (data) {
      await a.from("memos").delete().eq("author_id", data.id);
      await a.auth.admin.deleteUser(data.id);
    }
  }
  await a.from("profiles").update({ is_admin: false }).eq("id", ids.admin);
  for (const s of servers) await new Promise((r) => s.close(r));
});

async function pageFor(browser: Browser, email: string, next = "/"): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await context.newPage();
  await signIn(page, email, next);
  return page;
}

async function latestLink(to: string, since: number): Promise<string> {
  const res = await fetch(`${mailApi}/messages/latest?to=${encodeURIComponent(to)}&since=${since}&wait=15000`);
  expect(res.ok).toBe(true);
  const message = (await res.json()) as { links: string[] };
  const link = message.links.find((l) => l.includes("token_hash="));
  expect(link).toBeTruthy();
  return link as string;
}

// ---------- invitations and first sign-in ----------

test("an admin invites people on /team; others do not see the form", async ({ browser }) => {
  const page = await pageFor(browser, ADMIN, "/team");
  await expect(page.getByRole("heading", { name: fr.inviteH })).toBeVisible();
  await expect(page.locator(".tm-hint").first()).toContainText("localhost:3000");

  const email = page.locator("#tmInviteEmail");
  await email.fill("not an email");
  await page.locator("#tmInviteBtn").click();
  await expect(page.locator(".toast")).toHaveText(fr.badEmail);

  await email.fill(`  ${INVITED.toUpperCase()} `);
  await page.locator("#tmInviteTeam").selectOption("growth");
  await page.locator("#tmInviteBtn").click();
  await expect(page.locator(".toast")).toHaveText(fr.invited);
  await expect(page.locator(`#tmInvites li[data-email="${INVITED}"]`)).toContainText("Growth");

  await email.fill(FREE);
  await page.locator("#tmInviteBtn").click();
  await expect(page.locator(`#tmInvites li[data-email="${FREE}"]`)).toBeVisible();

  // Twice: said, not stored twice.
  await email.fill(FREE);
  await page.locator("#tmInviteBtn").click();
  await expect(page.locator(".toast")).toHaveText(fr.inviteDup);
  // Someone who already has an account.
  await email.fill(GUEST);
  await page.locator("#tmInviteBtn").click();
  await expect(page.locator(".toast")).toHaveText(fr.inviteAlready);

  // Kept after a reload (stored), removable.
  await page.reload();
  await expect(page.locator(`#tmInvites li[data-email="${INVITED}"]`)).toBeVisible();
  await page.locator(`#tmInvites li[data-email="${FREE}"] button`).click();
  await expect(page.locator(".toast")).toHaveText(fr.inviteRemoved);
  await expect(page.locator(`#tmInvites li[data-email="${FREE}"]`)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`#tmInvites li[data-email="${FREE}"]`)).toHaveCount(0);
  // Back for the next test.
  await email.fill(FREE);
  await page.locator("#tmInviteBtn").click();
  await expect(page.locator(`#tmInvites li[data-email="${FREE}"]`)).toBeVisible();
  await page.context().close();

  const member = await pageFor(browser, AUTHOR, "/team");
  await expect(member.getByRole("heading", { name: fr.teamH, exact: true })).toBeVisible();
  await expect(member.locator("#tmInviteEmail")).toHaveCount(0);
  // Not even through the API.
  const { count } = await admin().from("invitations").select("email", { count: "exact", head: true });
  expect(count).toBeGreaterThanOrEqual(2);
  await member.context().close();
});

test("an invited Gmail address signs in, gives its name and lands in its pôle", async ({ page }) => {
  await page.goto("/login");
  const since = Date.now();
  await page.getByLabel(fr.emailL).fill(INVITED);
  await page.getByRole("button", { name: fr.sendLink }).click();
  await expect(page.getByRole("status").filter({ hasText: "C’est envoyé" })).toBeVisible();
  await page.goto(await latestLink(INVITED, since));

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: fr.welcomeH, exact: true })).toBeVisible();
  // Their pôle came with the invitation: only the name is asked.
  await expect(page.locator(".wl-given")).toHaveText("Ton pôle : Growth.");
  await expect(page.locator(".wl-poles")).toHaveCount(0);
  await expect(page.locator("#wl-name")).toHaveValue("");
  await page.locator("#wlGo").click();
  await expect(page.locator("#wl-msg")).toHaveText(fr.nameRequired);
  await page.locator("#wl-name").fill("  Nina   Nouvelle ");
  await page.locator("#wlGo").click();
  await expect(page).toHaveURL(/\/\?team=growth$/);

  // Done: /welcome sends them on, and the name is saved.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/$/);
  const { data } = await admin().from("profiles").select("full_name, onboarded_at").eq("email", INVITED).single();
  expect(data?.full_name).toBe("Nina Nouvelle");
  expect(data?.onboarded_at).toBeTruthy();
});

test("someone invited without a pôle chooses it at the first sign-in", async ({ browser }) => {
  await ensureUser(FREE, { onboarded: false, teams: [] });
  const page = await pageFor(browser, FREE, "/team");
  // Any page leads to /welcome first, then back where they were going.
  await expect(page).toHaveURL(/\/welcome\?next=%2Fteam$/);
  await page.locator("#wl-name").fill("Fred Libre");
  await page.locator("#wlGo").click();
  await expect(page.locator("#wl-msg")).toHaveText(fr.welcomeNeedPole);
  await page.locator(".wl-pole", { hasText: "Finance" }).click();
  await page.locator("#wlGo").click();
  await expect(page).toHaveURL(/\/team$/);
  const { data } = await admin()
    .from("profiles")
    .select("full_name, team_members(team)")
    .eq("email", FREE)
    .single();
  expect(data?.full_name).toBe("Fred Libre");
  expect(data?.team_members.map((m) => m.team)).toEqual(["finance"]);
  await page.context().close();
});

// ---------- the people of the call ----------

test("the author adds people to the call; they read the memo, even from another pôle", async ({ browser }) => {
  const guest = await pageFor(browser, GUEST, `/memos/${memoId}`);
  await expect(guest.locator(".solo-card .intro")).toHaveText(fr.notFound);

  const page = await pageFor(browser, AUTHOR, `/memos/${memoId}`);
  const panel = page.locator("#call");
  await expect(panel.getByRole("heading", { name: fr.callH })).toBeVisible();
  await expect(panel.locator("#callNone")).toHaveText(fr.callNone);

  // By name (a profile), then by address; a typo is refused.
  await panel.locator("#callAdd").fill("gabi invitée");
  await panel.locator("#callAddBtn").click();
  await expect(page.locator(".toast")).toHaveText(fr.callAdded);
  await expect(panel.locator(`#callPeople li[data-email="${GUEST}"]`)).toHaveText(/Gabi Invitée/);
  await panel.locator("#callAdd").fill("CL-Outside@Gmail.test");
  await panel.locator("#callAddBtn").click();
  await expect(panel.locator('#callPeople li[data-email="cl-outside@gmail.test"]')).toBeVisible();
  await panel.locator("#callAdd").fill("personne");
  await panel.locator("#callAddBtn").click();
  await expect(page.locator(".toast")).toHaveText(fr.badEmail);

  // The date (Paris time in this browser).
  const when = new Date(Date.now() + 86_400_000);
  const local = `${when.toISOString().slice(0, 10)}T15:30`;
  await panel.locator("#callWhen").fill(local);
  await panel.locator("#callWhen").blur();
  await expect(page.locator(".toast")).toHaveText(fr.callDateSaved);
  const { data: call } = await admin().from("memo_calls").select("starts_at").eq("memo_id", memoId).single();
  expect(new Date(call!.starts_at!).toISOString()).toBe(new Date(`${local}:00+02:00`).toISOString());

  // Saved: a reload shows the same.
  await page.reload();
  await expect(panel.locator("#callPeople li")).toHaveCount(2);
  await expect(panel.locator("#callWhen")).toHaveValue(local);

  // The guest now reads it (read-only) and sees who else is in the call.
  await guest.reload();
  await expect(guest.locator("#fTitle")).toHaveValue(`cl memo ${stamp}`);
  await expect(guest.locator("#fTitle")).toHaveAttribute("readonly", "");
  await expect(guest.locator("#call #callPeople li")).toHaveCount(2);
  await expect(guest.locator("#callAdd")).toHaveCount(0);
  // …and finds it on the home page under their next calls.
  await guest.goto("/");
  await expect(guest.locator(`#callsList .calls-row[data-key="m:${memoId}"]`)).toContainText(`cl memo ${stamp}`);
  await expect(guest.locator(`#callsList .calls-row[data-key="m:${memoId}"] .calls-open`)).toHaveText(`✓${fr.callsOpen}`);

  // Removed: hidden again.
  await panel.locator(`#callPeople li[data-email="${GUEST}"] .cx`).click();
  await expect(page.locator(".toast")).toHaveText(fr.callRemoved);
  await guest.goto(`/memos/${memoId}`);
  await expect(guest.locator(".solo-card .intro")).toHaveText(fr.notFound);
  // Back in for Slack.
  await panel.locator("#callAdd").fill(GUEST);
  await panel.locator("#callAddBtn").click();
  await expect(panel.locator(`#callPeople li[data-email="${GUEST}"]`)).toBeVisible();

  await guest.context().close();
  await page.context().close();
});

test("Send on Slack DMs the people found on Slack and names the others", async ({ browser }) => {
  const page = await pageFor(browser, AUTHOR, `/memos/${memoId}`);
  dms.length = 0;
  await page.locator("#bSlack").click();
  await expect(page.locator(".toast")).toHaveText(`${fr.slackSentOne} Pas trouvé sur Slack : cl-outside@gmail.test.`);
  expect(dms).toHaveLength(1);
  expect(dms[0].channel).toBe("UGUEST");
  expect(dms[0].auth).toBe(`Bearer ${SLACK_TOKEN}`);
  expect(dms[0].text).toBe(`Alix Auteur te partage un mémo pour l’appel : cl memo ${stamp}`);
  expect(JSON.stringify(dms[0].blocks)).toContain(`/memos/${memoId}`);
  expect(JSON.stringify(dms[0].blocks)).toContain("<!date^");
  await page.context().close();

  // A reader cannot send it (no button; the route says no too).
  const guest = await pageFor(browser, GUEST, `/memos/${memoId}`);
  await expect(guest.locator("#bSlack")).toHaveCount(0);
  const res = await guest.request.post("/api/slack", { data: { memoId } });
  expect(res.status()).toBe(403);
  await guest.context().close();
});

// ---------- the calendar on the home page ----------

test("connect a calendar, see the next calls, prepare a memo from one", async ({ browser }) => {
  const page = await pageFor(browser, AUTHOR, "/");
  await expect(page.getByRole("heading", { name: fr.callsH })).toBeVisible();
  await page.locator("#calConnect").click();
  const dialog = page.locator(".calbox");
  await expect(dialog.getByRole("heading", { name: fr.calH })).toBeVisible();
  await expect(dialog).toContainText("Adresse secrète au format iCal");

  // Refused: another host; a page that is not a calendar.
  await dialog.locator("#calUrl").fill("https://evil.example.com/cal.ics");
  await dialog.locator("#calSave").click();
  await expect(dialog.locator("#calMsg")).toHaveText(fr.calBadHost);
  await dialog.locator("#calUrl").fill(`${CAL_URL}/not-a-calendar`);
  await dialog.locator("#calSave").click();
  await expect(dialog.locator("#calMsg")).toHaveText(fr.calNotIcs);

  await dialog.locator("#calUrl").fill(`${CAL_URL}/cal.ics`);
  await dialog.locator("#calSave").click();
  await expect(page.locator(".toast")).toHaveText(fr.calSaved);
  await expect(dialog).toHaveCount(0);

  const row = page.locator(`#callsList .calls-row[data-key="e:cl-call-${stamp}@e2e"]`);
  await expect(row).toContainText("Point stock e2e");
  await expect(row).toContainText("avec Gabi Invitée, cl-outside");
  await expect(page.locator(`#callsList .calls-row[data-key="e:cl-later-${stamp}@e2e"]`)).toContainText("Revue budget e2e");
  // The memo with a call tomorrow is listed too, before them.
  await expect(page.locator("#callsList .calls-row").first()).toHaveAttribute("data-key", `m:${memoId}`);

  await row.getByRole("button", { name: fr.callsPrepare }).click();
  await expect(page).toHaveURL(/\/memos\/[0-9a-f-]{36}$/);
  const prepared = page.url().split("/").pop() as string;
  await expect(page.locator("#fTitle")).toHaveValue("Point stock e2e");
  await expect(page.locator("#fMeta0")).toHaveValue("Gabi Invitée, cl-outside@gmail.test");
  await expect(page.locator("#fMeta1")).toHaveValue("Alix Auteur");
  await expect(page.locator("#fMeta2")).toHaveValue(/2026|202\d/);
  await expect(page.locator("#fMeta3")).toHaveValue("Point stock e2e");
  await expect(page.locator("#call #callPeople li")).toHaveCount(2);

  // Home: the event now opens its memo; preparing again reopens the same memo.
  await page.goto("/");
  await expect(row.locator(".calls-open")).toHaveAttribute("href", `/memos/${prepared}`);
  const { count } = await admin()
    .from("memo_calls")
    .select("memo_id", { count: "exact", head: true })
    .eq("event_id", `cl-call-${stamp}@e2e`);
  expect(count).toBe(1);

  // The guest (an attendee) sees it ready on their own home page, without a calendar.
  const guest = await pageFor(browser, GUEST, "/");
  await expect(guest.locator(`#callsList .calls-row[data-key="m:${prepared}"]`)).toContainText("Point stock e2e");
  await guest.context().close();

  // Disconnect: the link is gone.
  await page.locator("#calChange").click();
  await page.locator("#calRemove").click();
  await expect(page.locator(".toast")).toHaveText(fr.calRemoved);
  await expect(page.locator("#calConnect")).toBeVisible();
  const { count: links } = await admin().from("calendar_links").select("user_id", { count: "exact", head: true }).eq("user_id", ids.author);
  expect(links).toBe(0);
  await page.context().close();
});
