// Refresh tokens at rest: AES-256-GCM with a key only the server has. Format
// "v1.<iv>.<tag>.<ciphertext>", each part base64url. Unit-tested.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** The token, or null when the value was not made with this key (or is damaged). */
export function decryptToken(value: string, key: Buffer): string | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
