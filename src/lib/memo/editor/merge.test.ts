import { describe, expect, it } from "vitest";
import type { FullMemoContent, MiniMemoContent } from "@/lib/memo/model";
import { mergeDocs, sameDoc } from "./merge";
import type { DocSnapshot } from "./payload";

const full = (over: Partial<FullMemoContent> = {}): FullMemoContent => ({
  kind: "memo",
  author: "Rita",
  meta: ["Damien", "Rita", "lundi", "Sujet"],
  s: ["why", "what", "how", "now"],
  acts: [
    { id: "a1", action: "A1", owner: "Rita", due: "lundi" },
    { id: "a2", action: "A2", owner: "", due: "" },
  ],
  needs: [{ id: "n1", done: false, text: "N1" }],
  res: "res",
  qs: [
    { id: "q1", q: "Q1" },
    { id: "q2", q: "Q2" },
  ],
  ...over,
});
const doc = (over: Partial<DocSnapshot> = {}, c: Partial<FullMemoContent> = {}): DocSnapshot => ({
  title: "Title",
  deciderId: "d1",
  lang: "fr",
  content: full(c),
  ...over,
});
const fullOf = (d: DocSnapshot) => d.content as FullMemoContent;

describe("mergeDocs", () => {
  it("takes the side that changed each field", () => {
    const base = doc();
    const local = doc({ title: "Local title" }, { s: ["why (local)", "what", "how", "now"] });
    const server = doc({ deciderId: "d2" }, { meta: ["Damien", "Rita", "mardi", "Sujet"], res: "server res" });
    const m = mergeDocs(base, local, server);
    expect(m.conflict).toBe(false);
    expect(m.doc.title).toBe("Local title");
    expect(m.doc.deciderId).toBe("d2");
    expect(m.doc.content.s).toEqual(["why (local)", "what", "how", "now"]);
    expect(m.doc.content.meta).toEqual(["Damien", "Rita", "mardi", "Sujet"]);
    expect(fullOf(m.doc).res).toBe("server res");
  });

  it("keeps local and flags a conflict when both changed the same field differently", () => {
    const m = mergeDocs(doc(), doc({ title: "mine" }), doc({ title: "theirs" }));
    expect(m).toMatchObject({ conflict: true, doc: { title: "mine" } });
    // Same change on both sides: no conflict.
    expect(mergeDocs(doc(), doc({ title: "same" }), doc({ title: "same" })).conflict).toBe(false);
    // The language follows the last editor: never a warning.
    expect(mergeDocs(doc(), doc({ lang: "en" }), doc({ lang: "fr", title: "x" }))).toMatchObject({ conflict: false });
  });

  it("merges rows by id: edits per field, additions on both sides, removals", () => {
    const base = doc();
    const local = doc(
      {},
      {
        acts: [
          { id: "a1", action: "A1 local", owner: "Rita", due: "lundi" },
          { id: "a2", action: "A2", owner: "", due: "" },
          { id: "a3", action: "added here", owner: "", due: "" },
        ],
        qs: [{ id: "q1", q: "Q1" }], // q2 removed here
      },
    );
    const server = doc(
      {},
      {
        acts: [
          { id: "a1", action: "A1", owner: "Lukas", due: "lundi" },
          { id: "a4", action: "added there", owner: "", due: "" },
        ], // a2 removed there
        needs: [{ id: "n1", done: true, text: "N1" }],
        qs: [
          { id: "q1", q: "Q1 (server)" },
          { id: "q2", q: "Q2" },
        ],
      },
    );
    const m = mergeDocs(base, local, server);
    expect(m.conflict).toBe(false);
    const c = fullOf(m.doc);
    // a3 followed a2 here; a2 is gone, so it comes right after a1.
    expect(c.acts).toEqual([
      { id: "a1", action: "A1 local", owner: "Lukas", due: "lundi" },
      { id: "a3", action: "added here", owner: "", due: "" },
      { id: "a4", action: "added there", owner: "", due: "" },
    ]);
    expect(c.needs).toEqual([{ id: "n1", done: true, text: "N1" }]);
    expect(c.qs).toEqual([{ id: "q1", q: "Q1 (server)" }]);
  });

  it("places a row added here after the row it followed", () => {
    const base = doc();
    const local = doc(
      {},
      {
        acts: [
          { id: "a1", action: "A1", owner: "Rita", due: "lundi" },
          { id: "new", action: "between", owner: "", due: "" },
          { id: "a2", action: "A2", owner: "", due: "" },
        ],
      },
    );
    const m = mergeDocs(base, local, doc({ title: "server" }));
    expect(fullOf(m.doc).acts.map((a) => a.id)).toEqual(["a1", "new", "a2"]);
  });

  it("a row edited on one side and removed on the other: an edit here wins, a removal here wins, both flagged", () => {
    const editedHere = doc({}, { qs: [{ id: "q1", q: "Q1" }, { id: "q2", q: "Q2 edited" }] });
    const removedThere = doc({}, { qs: [{ id: "q1", q: "Q1" }] });
    const a = mergeDocs(doc(), editedHere, removedThere);
    expect(a.conflict).toBe(true);
    expect(fullOf(a.doc).qs.map((q) => q.q)).toEqual(["Q1", "Q2 edited"]);

    const removedHere = doc({}, { qs: [{ id: "q1", q: "Q1" }] });
    const editedThere = doc({}, { qs: [{ id: "q1", q: "Q1" }, { id: "q2", q: "Q2 edited" }] });
    const b = mergeDocs(doc(), removedHere, editedThere);
    expect(b.conflict).toBe(true);
    expect(fullOf(b.doc).qs.map((q) => q.id)).toEqual(["q1"]);
  });

  it("rows both sides have but the base does not (the base predates a save) keep the local text", () => {
    const local = doc({}, { qs: [{ id: "q1", q: "Q1" }, { id: "q3", q: "typed more" }] });
    const server = doc({}, { qs: [{ id: "q1", q: "Q1" }, { id: "q3", q: "typed" }] });
    const m = mergeDocs(doc({}, { qs: [{ id: "q1", q: "Q1" }] }), local, server);
    expect(m.conflict).toBe(false);
    expect(fullOf(m.doc).qs).toEqual([
      { id: "q1", q: "Q1" },
      { id: "q3", q: "typed more" },
    ]);
  });

  it("merges the mini memo's fields", () => {
    const mini = (works: string, s0 = "what"): DocSnapshot => ({
      title: "Mini",
      deciderId: null,
      lang: "en",
      content: { kind: "mini", author: "A", meta: ["", "", "", ""], s: [s0, "", "", ""], works } as MiniMemoContent,
    });
    const m = mergeDocs(mini("w"), mini("w local"), mini("w", "what (server)"));
    expect(m.conflict).toBe(false);
    expect(m.doc.content).toMatchObject({ kind: "mini", works: "w local", s: ["what (server)", "", "", ""] });
  });
});

describe("sameDoc", () => {
  it("compares title, decider, language and content", () => {
    expect(sameDoc(doc(), doc())).toBe(true);
    expect(sameDoc(doc(), doc({ deciderId: null }))).toBe(false);
    expect(sameDoc(doc(), doc({}, { res: "other" }))).toBe(false);
  });
});
