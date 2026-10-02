import { describe, expect, it } from "vitest";
import { passwordProblem, redactEmails, setupStatusCode, signInErrorCode } from "./login-error";

describe("signInErrorCode", () => {
  it("maps wrong passwords and unknown addresses the same way", () => {
    expect(signInErrorCode({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
      "badCredentials",
    );
    expect(signInErrorCode({ status: 400, message: "Invalid login credentials" })).toBe("badCredentials");
    expect(signInErrorCode({ status: 400, code: "email_not_confirmed" })).toBe("badCredentials");
  });
  it("maps rate limits and invalid addresses", () => {
    expect(signInErrorCode({ status: 429, code: "over_request_rate_limit" })).toBe("rateLimited");
    expect(signInErrorCode({ code: "validation_failed", message: "Unable to validate email address: invalid format" })).toBe(
      "badEmail",
    );
  });
  it("maps everything else to loginError", () => {
    expect(signInErrorCode({ status: 500, message: "boom" })).toBe("loginError");
  });
});

describe("setupStatusCode", () => {
  it("maps each status of set_password_with_code", () => {
    expect(setupStatusCode("ok")).toBeNull();
    expect(setupStatusCode("invalid")).toBe("codeInvalid");
    expect(setupStatusCode("expired")).toBe("codeExpired");
    expect(setupStatusCode("locked")).toBe("codeLocked");
    expect(setupStatusCode("weak")).toBe("weakPassword");
    expect(setupStatusCode(null)).toBe("loginError");
  });
});

describe("passwordProblem", () => {
  it("wants 8 characters and at most 72 bytes", () => {
    expect(passwordProblem("short")).toBe("weakPassword");
    expect(passwordProblem("long enough")).toBeNull();
    expect(passwordProblem("é".repeat(37))).toBe("weakPassword");
  });
});

describe("redactEmails", () => {
  it("hides addresses in log lines", () => {
    expect(redactEmails('User "ana@gmail.com" not found')).toBe('User "<email>" not found');
  });
});
