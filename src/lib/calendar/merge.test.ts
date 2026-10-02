import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./ics";
import { type CallMemo, mergeCalls } from "./merge";

const viewer = { id: "me", email: "Me@Gmail.com" };
const ev = (id: string, start: string, people: string[] = []): CalendarEvent => ({
  id,
  title: `Event ${id}`,
  start,
  end: start,
  allDay: false,
  people,
});
const memo = (id: string, over: Partial<CallMemo> = {}): CallMemo => ({
  id,
  title: `Memo ${id}`,
  status: "draft",
  authorId: "other",
  startsAt: null,
  eventId: null,
  ...over,
});

describe("mergeCalls", () => {
  it("attaches the memo prepared from an event to it, preferring the viewer's own", () => {
    const lines = mergeCalls(
      [ev("e1", "2026-10-05T08:00:00Z", ["me@gmail.com", "matteo@gmail.com"])],
      [memo("m1", { eventId: "e1" }), memo("m2", { eventId: "e1", authorId: "me" })],
      viewer,
    );
    // m1 (another memo for the same event, no date of its own) adds no line.
    expect(lines).toHaveLength(1);
    expect(lines[0].memo?.id).toBe("m2");
    expect(lines[0].people).toEqual(["matteo@gmail.com"]);
  });

  it("adds the memos of calls that match no event, in time order, and drops archived ones", () => {
    const lines = mergeCalls(
      [ev("e1", "2026-10-05T08:00:00Z")],
      [
        memo("late", { startsAt: "2026-10-09T08:00:00Z" }),
        memo("early", { startsAt: "2026-10-03T08:00:00Z" }),
        memo("gone", { startsAt: "2026-10-04T08:00:00Z", status: "archived" }),
        memo("undated"),
      ],
      viewer,
    );
    expect(lines.map((l) => l.key)).toEqual(["m:early", "e:e1", "m:late"]);
    expect(lines[0].event).toBeNull();
    expect(lines[1].memo).toBeNull();
  });

  it("keeps at most `max` lines", () => {
    const events = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, `2026-10-${String(i + 10)}T08:00:00Z`));
    expect(mergeCalls(events, [], viewer, 5)).toHaveLength(5);
  });
});
