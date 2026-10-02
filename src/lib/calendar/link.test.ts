import { describe, expect, it } from "vitest";
import { isAllowedCalendarHost, normalizeCalendarUrl } from "./link";

describe("normalizeCalendarUrl", () => {
  it("accepts Google, Proton, Outlook and iCloud links", () => {
    for (const url of [
      "https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics",
      "https://calendar.proton.me/api/calendar/v1/url/AbC/calendar.ics?CacheKey=x&PassphraseKey=y",
      "https://outlook.office365.com/owa/calendar/abc/def/calendar.ics",
      "https://p42-caldav.icloud.com/published/2/abc",
    ]) {
      expect(normalizeCalendarUrl(`  ${url} `)).toEqual({ ok: true, url });
    }
  });

  it("turns webcal:// into https://", () => {
    expect(normalizeCalendarUrl("webcal://p42-caldav.icloud.com/published/2/abc")).toEqual({
      ok: true,
      url: "https://p42-caldav.icloud.com/published/2/abc",
    });
  });

  it("refuses other hosts, http, ports, credentials and junk", () => {
    expect(normalizeCalendarUrl("https://evil.example.com/cal.ics")).toEqual({ ok: false, error: "calBadHost" });
    expect(normalizeCalendarUrl("https://calendar.google.com.evil.com/x")).toEqual({ ok: false, error: "calBadHost" });
    expect(normalizeCalendarUrl("http://calendar.google.com/x.ics")).toEqual({ ok: false, error: "calBadHost" });
    expect(normalizeCalendarUrl("https://calendar.google.com:8443/x.ics")).toEqual({ ok: false, error: "calBadHost" });
    expect(normalizeCalendarUrl("http://169.254.169.254/latest")).toEqual({ ok: false, error: "calBadHost" });
    expect(normalizeCalendarUrl("https://user:pw@calendar.google.com/x")).toEqual({ ok: false, error: "calBadUrl" });
    expect(normalizeCalendarUrl("ftp://calendar.google.com/x")).toEqual({ ok: false, error: "calBadUrl" });
    expect(normalizeCalendarUrl("not a link")).toEqual({ ok: false, error: "calBadUrl" });
    expect(normalizeCalendarUrl("")).toEqual({ ok: false, error: "calBadUrl" });
    expect(normalizeCalendarUrl(null)).toEqual({ ok: false, error: "calBadUrl" });
  });

  it("allows a local mock only when listed for tests", () => {
    expect(normalizeCalendarUrl("http://localhost:4011/cal.ics", [])).toEqual({ ok: false, error: "calBadHost" });
    expect(normalizeCalendarUrl("http://localhost:4011/cal.ics", ["localhost:4011"])).toEqual({
      ok: true,
      url: "http://localhost:4011/cal.ics",
    });
    expect(isAllowedCalendarHost(new URL("http://example.com:4011/x"), ["example.com:4011"])).toBe(false);
  });
});
