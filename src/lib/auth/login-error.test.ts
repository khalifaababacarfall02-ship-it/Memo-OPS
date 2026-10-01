import { describe, expect, it } from "vitest";
import { loginErrorCode, redactEmails } from "./login-error";

describe("loginErrorCode", () => {
  it("maps rate limits", () => {
    expect(loginErrorCode({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" })).toBe(
      "rateLimited",
    );
    expect(loginErrorCode({ status: 429, message: "For security purposes, you can only request this after 42 seconds." })).toBe(
      "rateLimited",
    );
    expect(loginErrorCode({ code: "over_request_rate_limit" })).toBe("rateLimited");
  });

  it("maps the auth.users trigger refusing the domain (as supabase-js reports it)", () => {
    // AuthRetryableFetchError: supabase-js drops the code of 5xx answers.
    expect(loginErrorCode({ status: 500, message: "Database error saving new user" })).toBe("badDomain");
    expect(loginErrorCode({ status: 500, code: "unexpected_failure", message: "Database error saving new user" })).toBe(
      "badDomain",
    );
    expect(loginErrorCode({ status: 500, message: "Database error creating new user" })).toBe("badDomain");
  });

  it("maps invalid addresses", () => {
    expect(loginErrorCode({ status: 400, code: "email_address_invalid", message: 'Email address "x@y" is invalid' })).toBe(
      "badEmail",
    );
    expect(
      loginErrorCode({ status: 400, code: "validation_failed", message: "Unable to validate email address: invalid format" }),
    ).toBe("badEmail");
  });

  it("maps everything else to sendError", () => {
    expect(loginErrorCode({ status: 500, code: "unexpected_failure", message: "Error sending magic link email" })).toBe(
      "sendError",
    );
    expect(loginErrorCode({ status: 400, code: "email_address_not_authorized", message: "Email address not authorized" })).toBe(
      "sendError",
    );
    expect(loginErrorCode({ status: 422, code: "otp_disabled", message: "Signups not allowed for otp" })).toBe("sendError");
    expect(loginErrorCode({ status: 0, message: "fetch failed" })).toBe("sendError");
    expect(loginErrorCode({})).toBe("sendError");
  });
});

describe("redactEmails", () => {
  it("removes addresses from log messages", () => {
    expect(redactEmails('Email address "Matteo@BoxHero.com" is invalid')).toBe('Email address "<email>" is invalid');
    expect(redactEmails("a@b.co and c.d+e@f.example.org failed")).toBe("<email> and <email> failed");
    expect(redactEmails("Error sending magic link email")).toBe("Error sending magic link email");
  });
});
