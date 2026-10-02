import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

describe("refresh token encryption", () => {
  const key = randomBytes(32);
  it("round-trips, with a fresh IV each time", () => {
    const a = encryptToken("1//refresh-token", key);
    const b = encryptToken("1//refresh-token", key);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(decryptToken(a, key)).toBe("1//refresh-token");
  });
  it("refuses another key, a damaged value and junk", () => {
    const a = encryptToken("secret", key);
    expect(decryptToken(a, randomBytes(32))).toBeNull();
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptToken(parts.join("."), key)).toBeNull();
    expect(decryptToken("plain", key)).toBeNull();
  });
});
