import { describe, expect, it } from "vitest";
import { ApiError, SaveError, classifyError, isRetryable } from "./errors";

const e = (message: string, code = "", status?: number) => new ApiError(message, code, status);

describe("classifyError", () => {
  it("connection problems and server errors are retried", () => {
    expect(classifyError(e("TypeError: Failed to fetch", "", 0))).toBe("network");
    expect(classifyError(new Error("offline"))).toBe("network");
    expect(classifyError(e("upstream", "", 503))).toBe("network");
    expect(classifyError(e("timeout", "", 408))).toBe("network");
    expect(isRetryable("network")).toBe(true);
  });

  it("an expired or missing session asks to sign in again", () => {
    expect(classifyError(e("JWT expired", "PGRST303", 401))).toBe("auth");
    expect(classifyError(e("permission denied for table memos", "42501", 401))).toBe("auth");
    expect(classifyError(e("JWSError JWSInvalidSignature", "PGRST301", 401))).toBe("auth");
  });

  it("maps the workflow guard's messages", () => {
    expect(classifyError(e("memo is locked once decided or archived", "42501", 403))).toBe("locked");
    expect(classifyError(e("only the decision maker can answer, while the memo is to decide", "42501", 403))).toBe("locked");
    expect(classifyError(e("only the author can edit this memo", "42501", 403))).toBe("notAllowed");
    expect(classifyError(e('new row violates row-level security policy for table "memos"', "42501", 403))).toBe("notAllowed");
    expect(classifyError(e("memo not saved", "PGRST116", 406))).toBe("notAllowed");
    const decider = e("a memo to decide needs a decision maker and a title", "23514", 400);
    expect(classifyError(decider, { title: "A title" })).toBe("needDecider");
    expect(classifyError(decider, { title: "  " })).toBe("needTitle");
    expect(classifyError(e("question not found in this memo", "23503", 409))).toBe("questionGone");
  });

  it("lengths and sizes are 'too long'", () => {
    expect(classifyError(e('new row for relation "memos" violates check constraint "memos_title_length"', "23514", 400))).toBe("tooLong");
    expect(classifyError(e("value too long", "22001", 400))).toBe("tooLong");
    expect(classifyError(e("Payload Too Large", "", 413))).toBe("tooLong");
    expect(classifyError(new SaveError("tooLong"))).toBe("tooLong");
  });

  it("any other refusal is not retried", () => {
    expect(classifyError(e("bad", "PGRST204", 400))).toBe("invalid");
    for (const k of ["auth", "locked", "notAllowed", "notFound", "tooLong", "needDecider", "needTitle", "questionGone", "invalid"] as const) {
      expect(isRetryable(k)).toBe(false);
    }
  });
});
