import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { toCalendarEvent } = await import("./calendar");
const { authUrl, emailFromIdToken } = await import("./oauth");

const cfg = {
  clientId: "cid.apps.googleusercontent.com",
  clientSecret: "secret",
  tokenKey: Buffer.alloc(32),
  authBase: "https://accounts.google.com",
  tokenBase: "https://oauth2.googleapis.com",
  apiBase: "https://www.googleapis.com",
};

describe("authUrl", () => {
  it("asks for read-only Calendar access, offline, with the state and a login hint", () => {
    const url = new URL(authUrl(cfg, { redirectUri: "https://memo.test/api/google/callback", state: "s123", loginHint: "a@gmail.com" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.events.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("s123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://memo.test/api/google/callback");
    expect(url.searchParams.get("login_hint")).toBe("a@gmail.com");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
});

describe("emailFromIdToken", () => {
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
  it("reads the address, lower-cased", () => {
    expect(emailFromIdToken(jwt({ email: "Khalifa@Gmail.com" }))).toBe("khalifa@gmail.com");
  });
  it("is null without one", () => {
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken("junk")).toBeNull();
    expect(emailFromIdToken(jwt({ sub: "1" }))).toBeNull();
  });
});

describe("toCalendarEvent", () => {
  it("maps a timed event with people and its Meet link", () => {
    expect(
      toCalendarEvent({
        id: "abc",
        iCalUID: "abc@google.com",
        summary: " Point stock ",
        start: { dateTime: "2026-10-05T10:00:00+02:00" },
        end: { dateTime: "2026-10-05T10:30:00+02:00" },
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        attendees: [
          { email: "Matteo@Gmail.com", responseStatus: "accepted" },
          { email: "nope@gmail.com", responseStatus: "declined" },
          { email: "room@resource.calendar.google.com", resource: true },
        ],
        organizer: { email: "khalifaboxhero@proton.me" },
      }),
    ).toEqual({
      id: "abc@google.com",
      title: "Point stock",
      start: "2026-10-05T08:00:00.000Z",
      end: "2026-10-05T08:30:00.000Z",
      allDay: false,
      people: ["matteo@gmail.com", "khalifaboxhero@proton.me"],
      link: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("keys one occurrence of a repeating event like the iCal reader", () => {
    const e = toCalendarEvent({
      id: "w_20261012T070000Z",
      iCalUID: "weekly@google.com",
      recurringEventId: "w",
      originalStartTime: { dateTime: "2026-10-12T09:00:00+02:00" },
      start: { dateTime: "2026-10-12T14:00:00+02:00" },
      end: { dateTime: "2026-10-12T14:30:00+02:00" },
    });
    expect(e?.id).toBe("weekly@google.com|2026-10-12T07:00:00.000Z");
  });

  it("drops cancelled events and keeps all-day ones as such", () => {
    expect(toCalendarEvent({ id: "x", status: "cancelled", start: { dateTime: "2026-10-05T10:00:00Z" } })).toBeNull();
    expect(toCalendarEvent({ id: "y", start: { date: "2026-10-06" }, end: { date: "2026-10-07" } })?.allDay).toBe(true);
    expect(toCalendarEvent({ summary: "no id", start: { dateTime: "2026-10-05T10:00:00Z" } })).toBeNull();
  });
});
