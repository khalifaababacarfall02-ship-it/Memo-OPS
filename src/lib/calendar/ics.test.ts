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
