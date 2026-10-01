import { describe, expect, it } from "vitest";
import { fmtDate } from "./format";
import { LIST_PAGE, MAX_LIST_LIMIT, listHref, parseListLimit, parseListParams } from "./params";

describe("parseListParams", () => {
  it("defaults to every team, every status but archived, no search", () => {
    expect(parseListParams({})).toEqual({ team: null, status: "all", q: "" });
  });

  it("reads valid values", () => {
    expect(parseListParams({ team: "growth", status: "to_decide", q: "  retours  " })).toEqual({
      team: "growth",
      status: "to_decide",
      q: "retours",
    });
    expect(parseListParams({ status: "archived" }).status).toBe("archived");
    expect(parseListParams({ status: "all" }).status).toBe("all");
  });

  it("ignores invalid values", () => {
    expect(parseListParams({ team: "marketing", status: "deleted" })).toEqual({ team: null, status: "all", q: "" });
    expect(parseListParams({ team: "OPS", status: "Draft" })).toEqual({ team: null, status: "all", q: "" });
    expect(parseListParams({ team: "__proto__", status: "constructor" })).toEqual({ team: null, status: "all", q: "" });
  });

  it("takes the first value of repeated parameters", () => {
    expect(parseListParams({ team: ["sav", "ops"], status: ["decided", "draft"], q: ["a", "b"] })).toEqual({
      team: "sav",
      status: "decided",
      q: "a",
    });
  });

  it("caps the search text without splitting characters", () => {
    const q = parseListParams({ q: "😀".repeat(1000) }).q;
    expect(Array.from(q).length).toBeLessThanOrEqual(200);
    expect(q.isWellFormed()).toBe(true);
  });
});

describe("listHref", () => {
  it("leaves the defaults out", () => {
    expect(listHref({ team: null, status: "all", q: "" })).toBe("/");
    expect(listHref({ team: null, status: "all", q: "   " })).toBe("/");
  });

  it("keeps team, status and search", () => {
    expect(listHref({ team: "ops", status: "decided", q: "retours amazon" })).toBe(
      "/?team=ops&status=decided&q=retours+amazon",
    );
    expect(listHref({ team: null, status: "archived", q: "" })).toBe("/?status=archived");
  });

  it("encodes the search text", () => {
    const href = listHref({ team: null, status: "all", q: "a&b=c #100% é" });
    expect(new URL(href, "http://x").searchParams.get("q")).toBe("a&b=c #100% é");
  });

  it("round-trips through parseListParams", () => {
    const filters = { team: "mini" as const, status: "to_decide" as const, q: "Œuvre, (test)" };
    const params = Object.fromEntries(new URL(listHref(filters), "http://x").searchParams);
    expect(parseListParams(params)).toEqual(filters);
  });

  it("adds the row limit after the first page, and keeps the filters", () => {
    const filters = { team: "ops" as const, status: "draft" as const, q: "retours" };
    expect(listHref(filters, LIST_PAGE)).toBe("/?team=ops&status=draft&q=retours");
    expect(listHref(filters, 400)).toBe("/?team=ops&status=draft&q=retours&limit=400");
    expect(listHref({ team: null, status: "all", q: "" }, 600)).toBe("/?limit=600");
    const params = Object.fromEntries(new URL(listHref(filters, 400), "http://x").searchParams);
    expect(parseListParams(params)).toEqual(filters);
    expect(parseListLimit(params)).toBe(400);
  });
});

describe("parseListLimit", () => {
  it("defaults to one page", () => {
    expect(parseListLimit({})).toBe(LIST_PAGE);
    expect(LIST_PAGE).toBe(200);
  });

  it("rounds up to whole pages", () => {
    expect(parseListLimit({ limit: "400" })).toBe(400);
    expect(parseListLimit({ limit: "401" })).toBe(600);
    expect(parseListLimit({ limit: "1" })).toBe(200);
    expect(parseListLimit({ limit: "0" })).toBe(200);
    expect(parseListLimit({ limit: ["800", "200"] })).toBe(800);
  });

  it("ignores anything else and caps huge values", () => {
    for (const limit of ["-400", "4e2", "400.5", " 400", "abc", "", "9999999"]) {
      expect(parseListLimit({ limit })).toBe(LIST_PAGE);
    }
    expect(parseListLimit({ limit: "999999" })).toBe(MAX_LIST_LIMIT);
  });
});

describe("fmtDate", () => {
  it("formats like the prototype, in Paris time", () => {
    expect(fmtDate("fr", "2026-09-29T07:00:00Z")).toBe("29 septembre à 09:00");
    expect(fmtDate("en", "2026-09-29T07:00:00Z")).toBe("29 September at 09:00");
    // Winter time.
    expect(fmtDate("fr", "2026-12-01T23:30:00Z")).toBe("2 décembre à 00:30");
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(fmtDate("fr", null)).toBe("");
    expect(fmtDate("fr", "not a date")).toBe("");
  });
});
