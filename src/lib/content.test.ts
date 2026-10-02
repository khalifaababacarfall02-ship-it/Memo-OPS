import { describe, expect, it } from "vitest";
import { content } from "./content";

// Every text must exist in both languages: a missing key would show
// "undefined" in one of them.
const keys = (o: unknown, p = ""): string[] =>
  o && typeof o === "object" && !Array.isArray(o)
    ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}${k}.`))
    : [p.slice(0, -1)];

describe("content/boxhero.json", () => {
  it("has the same keys in French and English", () => {
    expect(keys(content.en).sort()).toEqual(keys(content.fr).sort());
  });
  it("has colours and a cover for every team", () => {
    for (const t of content.teams) {
      expect(content.colors[t as keyof typeof content.colors]).toBeDefined();
      expect(content.covers[t as keyof typeof content.covers]).toMatch(/^\/covers\/.+\.jpg$/);
    }
  });
});
