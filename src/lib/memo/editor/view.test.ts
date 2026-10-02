import { describe, expect, it } from "vitest";
import { blankContent, type MemoRole, type MemoStatus } from "@/lib/memo/model";
import {
  answerPlaceholder,
  lockedKey,
  mineRows,
  saveErrorKey,
  permissionsOf,
  readOnlyReason,
  roleOf,
  statusErrorKey,
  submitProblem,
  visibleAnswers,
  workflowButtons,
} from "./view";

const AUTHOR: MemoRole = { isAuthor: true, isDecider: false, isAdmin: false };
const DECIDER: MemoRole = { isAuthor: false, isDecider: true, isAdmin: false };
const READER: MemoRole = { isAuthor: false, isDecider: false, isAdmin: false };
const ADMIN: MemoRole = { isAuthor: false, isDecider: false, isAdmin: true };
const t = (status: MemoStatus, role: MemoRole, stored = true) =>
  workflowButtons(status, role, { stored, mini: false }).map((b) => b.transition);

describe("roleOf", () => {
  it("compares the viewer with the author and the decision maker", () => {
    expect(roleOf({ id: "a", isAdmin: false }, { authorId: "a", deciderId: "d" })).toEqual(AUTHOR);
    expect(roleOf({ id: "d", isAdmin: false }, { authorId: "a", deciderId: "d" })).toEqual(DECIDER);
    expect(roleOf({ id: "x", isAdmin: true }, { authorId: "a", deciderId: null })).toEqual(ADMIN);
  });
});

describe("workflow buttons", () => {
  it("follows canTransition, main step first and archive last", () => {
    expect(t("draft", AUTHOR)).toEqual(["submit", "archive"]);
    expect(t("to_decide", AUTHOR)).toEqual(["withdraw", "archive"]);
    expect(t("to_decide", DECIDER)).toEqual(["decide", "archive"]);
    expect(t("decided", DECIDER)).toEqual(["reopen", "archive"]);
    expect(t("decided", AUTHOR)).toEqual(["archive"]);
    expect(t("archived", AUTHOR)).toEqual(["restore"]);
    expect(t("archived", DECIDER)).toEqual([]);
    expect(t("to_decide", READER)).toEqual([]);
    expect(t("to_decide", ADMIN)).toEqual(["decide", "withdraw", "archive"]);
  });

  it("offers only 'submit' on a memo that is not stored yet", () => {
    expect(t("draft", AUTHOR, false)).toEqual(["submit"]);
  });

  it("labels: accent buttons with a subtitle for submit and decide", () => {
    const [submit] = workflowButtons("draft", AUTHOR, { stored: true, mini: false });
    expect(submit).toEqual({ transition: "submit", label: "submit", sub: "submitSub", primary: true });
    expect(workflowButtons("draft", AUTHOR, { stored: true, mini: true })[0].sub).toBe("submitSubMini");
    const [decide, archive] = workflowButtons("to_decide", DECIDER, { stored: true, mini: false });
    expect(decide).toMatchObject({ label: "markDecided", sub: "markDecidedSub", primary: true });
    expect(archive).toMatchObject({ label: "archive", primary: false });
  });
});

describe("permissions", () => {
  it("explains why the sheet is read-only", () => {
    expect(readOnlyReason("draft", AUTHOR)).toBeNull();
    expect(readOnlyReason("to_decide", AUTHOR)).toBeNull();
    expect(readOnlyReason("to_decide", ADMIN)).toBeNull();
    expect(readOnlyReason("to_decide", DECIDER)).toBe("notAuthor");
    expect(readOnlyReason("draft", READER)).toBe("notAuthor");
    expect(readOnlyReason("decided", AUTHOR)).toBe("lockedDecided");
    expect(readOnlyReason("archived", AUTHOR)).toBe("lockedArchived");
  });

  it("only the decision maker (or an admin) answers, while to decide", () => {
    expect(permissionsOf("to_decide", DECIDER)).toEqual({ editContent: false, answer: true, reason: "notAuthor" });
    expect(permissionsOf("decided", DECIDER).answer).toBe(false);
    expect(permissionsOf("to_decide", AUTHOR).answer).toBe(false);
    expect(answerPlaceholder(DECIDER)).toBe("aPh");
    expect(answerPlaceholder(ADMIN)).toBe("aPh");
    expect(answerPlaceholder(AUTHOR)).toBe("answerWait");
    expect(answerPlaceholder(READER)).toBe("answerWait");
  });
});

describe("submit and errors", () => {
  it("needs a title, then a decision maker", () => {
    expect(submitProblem("  ", "d")).toBe("needTitle");
    expect(submitProblem("Title", null)).toBe("needDecider");
    expect(submitProblem("Title", "d")).toBeNull();
  });

  it("maps the database's refusals to messages", () => {
    expect(statusErrorKey({ code: "23514", message: "a memo to decide needs a decision maker and a title" })).toBe("needDecider");
    expect(statusErrorKey({ code: "42501", message: "memo status change not allowed: draft -> decided" })).toBe("notAllowed");
    expect(statusErrorKey({ code: "PGRST116", message: "status not changed" })).toBe("notAllowed");
    expect(statusErrorKey({ message: "Failed to fetch" })).toBe("saveError");
    expect(statusErrorKey({ code: "PGRST303", message: "JWT expired", status: 401 })).toBe("sessionExpired");
    expect(statusErrorKey(null)).toBe("notAllowed");
  });

  it("explains failed autosaves and locked memos", () => {
    expect(saveErrorKey("network")).toBe("saveError");
    expect(saveErrorKey("auth")).toBe("sessionExpired");
    expect(saveErrorKey("tooLong")).toBe("tooLong");
    expect(saveErrorKey("needTitle")).toBe("needTitle");
    expect(saveErrorKey("notAllowed")).toBe("notAllowed");
    expect(lockedKey("decided")).toBe("lockedDecided");
    expect(lockedKey("archived")).toBe("lockedArchived");
    expect(lockedKey("draft")).toBe("answersClosed");
  });

  it("the mini memo's 'Mark as decided' does not mention answers", () => {
    const [decide] = workflowButtons("to_decide", DECIDER, { stored: true, mini: true });
    expect(decide).toMatchObject({ transition: "decide", sub: undefined });
  });
});

describe("visibleAnswers", () => {
  it("keeps only answers to questions still in the memo", () => {
    const c = blankContent("ops");
    if (c.kind !== "memo") throw new Error("full memo expected");
    const qid = c.qs[0].id;
    expect(visibleAnswers(c, { [qid]: "yes", removed: "orphan" })).toEqual({ [qid]: "yes" });
    expect(visibleAnswers(blankContent("mini"), { x: "y" })).toEqual({});
  });
});

describe("mineRows", () => {
  const items = [
    { id: "a", title: "Old title", status: "draft" as const, updatedAt: "2026-10-01T10:00:00Z" },
    { id: "b", title: "B", status: "to_decide" as const, updatedAt: "2026-09-30T10:00:00Z" },
  ];

  it("shows the current memo live and only drafts as deletable", () => {
    const rows = mineRows(items, { id: "a", title: "Typed", status: "draft", at: "2026-10-01T11:00:00Z", mine: true }, false);
    expect(rows).toEqual([
      { id: "a", title: "Typed", at: "2026-10-01T11:00:00Z", current: true, deletable: true },
      { id: "b", title: "B", at: "2026-09-30T10:00:00Z", current: false, deletable: false },
    ]);
  });

  it("puts a memo that is not stored yet first", () => {
    const rows = mineRows(items, { id: null, title: "", status: "draft", at: "2026-10-01T12:00:00Z", mine: true }, false);
    expect(rows[0]).toEqual({ id: null, title: "", at: "2026-10-01T12:00:00Z", current: true, deletable: true });
    expect(rows).toHaveLength(3);
  });

  it("does not add someone else's memo; admins may delete anything", () => {
    const rows = mineRows(items, { id: "z", title: "Theirs", status: "to_decide", at: "x", mine: false }, true);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.deletable)).toBe(true);
  });
});
