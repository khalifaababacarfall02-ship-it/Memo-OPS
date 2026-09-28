import { describe, expect, it } from "vitest";
import { TEAMS, memoSections, miniSections, metaFields, placeholders } from "@/lib/content";
import {
  blankContent,
  canAnswer,
  canEditContent,
  canTransition,
  exampleMemo,
  normalizeContent,
  progress,
} from "./model";

describe("content accessors", () => {
  it("exposes the prototype structure in both languages", () => {
    for (const lang of ["fr", "en"] as const) {
      expect(memoSections(lang)).toHaveLength(5);
      expect(miniSections(lang)).toHaveLength(4);
      expect(metaFields(lang, "ops")).toHaveLength(4);
      expect(metaFields(lang, "mini")).toHaveLength(4);
      expect(placeholders(lang, "ops")).toHaveLength(4);
      expect(placeholders(lang, "mini")).toHaveLength(4);
    }
    expect(memoSections("fr")[0].label).toBe("POURQUOI");
    expect(memoSections("en")[4].label).toBe("QUESTIONS");
    expect(metaFields("fr", "ops")[3]).toEqual({ label: "OBJET", placeholder: "la décision demandée, en une phrase" });
  });
});

describe("blank and example memos", () => {
  it("matches the prototype's blank() shapes", () => {
    const full = blankContent("ops");
    expect(full.kind).toBe("memo");
    if (full.kind === "memo") {
      expect(full.acts).toHaveLength(2);
      expect(full.needs).toHaveLength(2);
      expect(full.qs).toHaveLength(1);
    }
    expect(blankContent("mini")).toMatchObject({ kind: "mini", works: "" });
  });

  it("builds a filled example for every team and language", () => {
    for (const lang of ["fr", "en"] as const) {
      for (const team of TEAMS) {
        const ex = exampleMemo(lang, team);
        expect(ex.title.length).toBeGreaterThan(5);
        expect(progress(ex.content).slice(0, 4).every(Boolean)).toBe(true);
        expect(JSON.stringify(ex.content)).not.toContain("**");
      }
    }
    const ops = exampleMemo("fr", "ops").content;
    if (ops.kind === "memo") {
      expect(ops.meta).toEqual(["Mattéo", "Khalifa", "29 septembre 2026", "Corriger les retours Amazon avant octobre"]);
      expect(ops.qs[0].q).toBe("On réétiquette le stock déjà chez Amazon, ou on le laisse s'écouler ?");
    }
  });
});

describe("normalizeContent", () => {
  it("repairs malformed jsonb without throwing", () => {
    const c = normalizeContent("ops", { meta: ["a", 2], s: "x", acts: [{ action: "Do", id: 3 }, null], qs: [{ q: "Why?" }] });
    expect(c.kind).toBe("memo");
    if (c.kind === "memo") {
      expect(c.meta).toEqual(["a", "", "", ""]);
      expect(c.s).toEqual(["", "", "", ""]);
      expect(c.acts).toHaveLength(1);
      expect(c.acts[0].action).toBe("Do");
      expect(typeof c.acts[0].id).toBe("string");
      expect(c.qs[0].q).toBe("Why?");
    }
    expect(normalizeContent("mini", null)).toMatchObject({ kind: "mini", works: "" });
  });
});

describe("workflow rules", () => {
  const author = { isAuthor: true, isDecider: false, isAdmin: false };
  const decider = { isAuthor: false, isDecider: true, isAdmin: false };
  const reader = { isAuthor: false, isDecider: false, isAdmin: false };
  it("lets each role do only its part", () => {
    expect(canTransition("submit", "draft", author)).toBe(true);
    expect(canTransition("submit", "draft", decider)).toBe(false);
    expect(canTransition("decide", "to_decide", decider)).toBe(true);
    expect(canTransition("decide", "to_decide", author)).toBe(false);
    expect(canTransition("decide", "draft", decider)).toBe(false);
    expect(canTransition("archive", "decided", reader)).toBe(false);
    expect(canEditContent("decided", author)).toBe(false);
    expect(canEditContent("to_decide", author)).toBe(true);
    expect(canAnswer("to_decide", decider)).toBe(true);
    expect(canAnswer("draft", decider)).toBe(false);
  });
});
