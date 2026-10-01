import { describe, expect, it } from "vitest";
import { blankContent } from "@/lib/memo/model";
import { fmtDate, fmtDay } from "./dates";
import * as E from "./edit";
import { answerRows, insertPayload, statusPayload, updatePayload } from "./payload";
import { nameOf, toPeople } from "./people";

const d = { title: "T", content: blankContent("ops"), deciderId: "dec", lang: "en" as const };

describe("payloads", () => {
  it("insert sends team, lang, title, content and decider (author and status are forced by SQL)", () => {
    const p = insertPayload("ops", d);
    expect(Object.keys(p).sort()).toEqual(["content", "decider_id", "lang", "team", "title"]);
    expect(p).toMatchObject({ team: "ops", lang: "en", title: "T", decider_id: "dec" });
  });

  it("autosave never sends the status; a status change sends only the status", () => {
    expect(Object.keys(updatePayload(d)).sort()).toEqual(["content", "decider_id", "lang", "title"]);
    expect(statusPayload("to_decide")).toEqual({ status: "to_decide" });
  });

  it("answers: only the changed ones, keyed by question id", () => {
    expect(answerRows("m", { q1: "a", q2: "b", q3: "" }, { q1: "a", q2: "old" })).toEqual([
      { memo_id: "m", question_id: "q2", answer: "b" },
    ]);
    expect(answerRows("m", { q1: "x" }, {})).toEqual([{ memo_id: "m", question_id: "q1", answer: "x" }]);
  });
});

describe("edits", () => {
  it("are immutable and keep row ids", () => {
    const c = blankContent("ops");
    if (c.kind !== "memo") throw new Error();
    const [q] = c.qs;
    const added = E.addQuestion(c);
    if (added.kind !== "memo") throw new Error();
    expect(added.qs).toHaveLength(2);
    expect(added.qs[0]).toBe(q);
    const edited = E.setQuestion(added, q.id, "Why?");
    if (edited.kind !== "memo") throw new Error();
    expect(edited.qs[0]).toEqual({ id: q.id, q: "Why?" });
    expect(c.qs[0].q).toBe("");
    const removed = E.removeQuestion(edited, added.qs[1].id);
    expect(removed.kind === "memo" && removed.qs.map((x) => x.id)).toEqual([q.id]);

    const act = c.acts[1].id;
    const a = E.setAct(c, act, "owner", "Lukas");
    expect(a.kind === "memo" && a.acts[1]).toEqual({ id: act, action: "", owner: "Lukas", due: "" });
    const n = E.setNeedDone(E.setNeedText(c, c.needs[0].id, "Go"), c.needs[0].id, true);
    expect(n.kind === "memo" && n.needs[0]).toMatchObject({ done: true, text: "Go" });
    expect(E.setMeta(c, 2, "date").meta).toEqual(["", "", "date", ""]);
    expect(E.setSection(c, 0, "why").s[0]).toBe("why");
  });

  it("full-memo parts do nothing on a mini memo, and the reverse", () => {
    const m = blankContent("mini");
    expect(E.addAct(m)).toBe(m);
    expect(E.setRes(m, "x")).toBe(m);
    expect(E.setWorks(m, "works")).toMatchObject({ works: "works" });
    expect(E.setWorks(blankContent("ops"), "x")).toMatchObject({ kind: "memo" });
  });

  it("choosing the decider fills an empty 'To' field only", () => {
    const c = blankContent("ops");
    expect(E.fillTo(c, "Mattéo").meta[0]).toBe("Mattéo");
    expect(E.fillTo(E.setMeta(c, 0, "Khalifa"), "Mattéo").meta[0]).toBe("Khalifa");
    const mini = blankContent("mini");
    expect(E.fillTo(mini, "Mattéo")).toBe(mini);
  });
});

describe("people and dates", () => {
  it("names people by full name, else email, sorted", () => {
    const people = toPeople(
      [
        { id: "2", full_name: "Zoé", email: "z@x" },
        { id: "1", full_name: "", email: "anna@x" },
        { id: "3", full_name: "Émile", email: "e@x" },
      ],
      "fr",
    );
    expect(people.map((p) => p.name)).toEqual(["anna@x", "Émile", "Zoé"]);
    expect(nameOf(people, "3")).toBe("Émile");
    expect(nameOf(people, null)).toBeNull();
    expect(nameOf(people, "nope")).toBeNull();
  });

  it("formats like the prototype's fmtDate()", () => {
    const iso = "2026-09-29T07:00:00Z";
    const fr = new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    expect(fmtDate(iso, "fr")).toBe(fr);
    expect(fmtDate("not a date", "fr")).toBe("");
    expect(fmtDate(null, "en")).toBe("");
    expect(fmtDay(iso, "en")).toMatch(/29 September 2026/);
  });
});
