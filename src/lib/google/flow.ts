import "server-only";
// The connect / callback steps of "Connecter Google Agenda", shared by the two
// route handlers. CSRF: a random state in an httpOnly cookie must come back.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { siteOrigin } from "@/lib/auth/site-url";

export const STATE_COOKIE = "bxh-gstate";
export const STATE_MAX_AGE = 10 * 60;

export const newState = (): string => randomBytes(24).toString("base64url");

export function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** The callback URL registered at Google: the site URL when set, else this request's origin. */
export function redirectUri(requestOrigin: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ? siteOrigin(process.env.NEXT_PUBLIC_SITE_URL) : requestOrigin;
  return `${site}/api/google/callback`;
}
