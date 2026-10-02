import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IcsError, upcomingEvents } from "./ics";

const google = readFileSync(join(__dirname, "fixtures", "google.ics"), "utf8");
const window = { from: new Date("2026-10-02T00:00:00Z"), to: new Date("2026-10-21T00:00:00Z") };

describe("upcomingEvents", () => {
  it("lists the window's events, earliest first, with repeating ones expanded", () => {
    const events = upcomingEvents(google, window);
    expect(events.map((e) => [e.start, e.title])).toEqual([
      ["2026-10-05T07:00:00.000Z", "Weekly ops"],
      ["2026-10-05T08:00:00.000Z", "Point stock, fournisseurs"],
      ["2026-10-06T00:00:00.000Z", "Salon"],
      ["2026-10-08T15:00:00.000Z", "Standup"],
      ["2026-10-09T15:00:00.000Z", "Standup"],
      ["2026-10-10T15:00:00.000Z", "Standup"],
      // 12 Oct: excluded (EXDATE). 19 Oct: moved to 14:00 Paris.
      ["2026-10-19T12:00:00.000Z", "Weekly ops (moved)"],
    ]);
  });

  it("keys one occurrence by UID + original start, a single event by its UID", () => {
    const events = upcomingEvents(google, window);
    expect(events[0].id).toBe("weekly@google.com|2026-10-05T07:00:00.000Z");
    expect(events.at(-1)?.id).toBe("weekly@google.com|2026-10-19T07:00:00.000Z");
    expect(events[1].id).toBe("call-1@google.com");
  });

  it("reads time zones from the file (Paris summer time here)", () => {
    const call = upcomingEvents(google, window).find((e) => e.id === "call-1@google.com");
    expect(call?.end).toBe("2026-10-05T08:30:00.000Z");
    expect(call?.allDay).toBe(false);
  });

  it("collects the people (lower case, once each, declined left out, organizer in)", () => {
    const call = upcomingEvents(google, window).find((e) => e.id === "call-1@google.com");
    expect(call?.people.sort()).toEqual(["khalifaboxhero@proton.me", "matteo@gmail.com"]);
  });

  it("marks all-day events and skips cancelled ones", () => {
    const events = upcomingEvents(google, window);
    expect(events.find((e) => e.title === "Salon")?.allDay).toBe(true);
    expect(events.some((e) => e.title === "Annulé")).toBe(false);
  });

  it("keeps the earliest `max`", () => {
    expect(upcomingEvents(google, { ...window, max: 2 }).map((e) => e.title)).toEqual(["Weekly ops", "Point stock, fournisseurs"]);
  });

  it("refuses what is not a calendar", () => {
    expect(() => upcomingEvents("<html>login</html>", window)).toThrow(IcsError);
    expect(() => upcomingEvents("BEGIN:VCALENDAR\r\nBROKEN", window)).toThrow(IcsError);
  });
});

describe("time zones the file does not define", () => {
  const cal = (body: string, head = "") =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", head, body, "END:VCALENDAR", ""].filter(Boolean).join("\r\n");
  const event = (uid: string, dtstart: string, extra = "") =>
    ["BEGIN:VEVENT", `UID:${uid}`, dtstart, "SUMMARY:x", extra, "END:VEVENT"].filter(Boolean).join("\r\n");
  const starts = (text: string) => upcomingEvents(text, window).map((e) => [e.id, e.start]);

  it("reads a named but undefined IANA zone, never the server's zone", () => {
    expect(starts(cal(event("a", "DTSTART;TZID=Europe/Paris:20261005T100000")))).toEqual([["a", "2026-10-05T08:00:00.000Z"]]);
    expect(starts(cal(event("w", "DTSTART;TZID=Romance Standard Time:20261005T100000")))).toEqual([
      ["w", "2026-10-05T08:00:00.000Z"],
    ]);
  });

  it("reads floating times in the calendar's zone (X-WR-TIMEZONE), else UTC", () => {
    expect(starts(cal(event("f", "DTSTART:20261005T100000"), "X-WR-TIMEZONE:Africa/Dakar"))).toEqual([
      ["f", "2026-10-05T10:00:00.000Z"],
    ]);
    expect(starts(cal(event("f", "DTSTART:20261005T100000"), "X-WR-TIMEZONE:Europe/Paris"))).toEqual([
      ["f", "2026-10-05T08:00:00.000Z"],
    ]);
    expect(starts(cal(event("f", "DTSTART:20261005T100000")))).toEqual([["f", "2026-10-05T10:00:00.000Z"]]);
  });

  it("one calendar's zone definitions never change how another is read", () => {
    const bogus = [
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Paris",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0500",
      "TZOFFSETTO:+0500",
      "END:STANDARD",
      "END:VTIMEZONE",
    ].join("\r\n");
    expect(starts(cal(`${bogus}\r\n${event("evil", "DTSTART;TZID=Europe/Paris:20261005T100000")}`))).toEqual([
      ["evil", "2026-10-05T05:00:00.000Z"],
    ]);
    expect(starts(cal(event("a", "DTSTART;TZID=Europe/Paris:20261005T100000")))).toEqual([["a", "2026-10-05T08:00:00.000Z"]]);
  });

  it("leaves rooms and shared calendars out of the people", () => {
    const text = cal(
      event(
        "r",
        "DTSTART:20261005T100000Z",
        [
          "ATTENDEE;CUTYPE=ROOM:mailto:salle@boxhero.test",
          "ATTENDEE:mailto:c_123@resource.calendar.google.com",
          "ATTENDEE:mailto:team@group.calendar.google.com",
          "ATTENDEE:mailto:ana@gmail.com",
        ].join("\r\n"),
      ),
    );
    expect(upcomingEvents(text, window)[0].people).toEqual(["ana@gmail.com"]);
  });
});
