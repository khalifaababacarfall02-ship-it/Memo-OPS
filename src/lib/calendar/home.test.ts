import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const { eventIdBatches } = await import("./home");

describe("eventIdBatches", () => {
  it("drops ids PostgREST cannot quote, and duplicates", () => {
    expect(eventIdBatches(['a"b', "c\\d", "ok", "ok", "x".repeat(501)])).toEqual([["ok"]]);
  });
  it("keeps each request short", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `${"u".repeat(200)}${i}@google.com|2026-10-05T07:00:00.000Z`);
    const batches = eventIdBatches(ids, 3000);
    expect(batches.flat()).toHaveLength(40);
    for (const b of batches) expect(b.map((id) => encodeURIComponent(id).length + 3).reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(3000);
    expect(batches.length).toBeGreaterThan(1);
  });
});
