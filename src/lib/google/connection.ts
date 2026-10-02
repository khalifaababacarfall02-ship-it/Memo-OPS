import "server-only";
// The signed-in person's Google Calendar connection (public.google_connections,
// read through RLS) turned into their next events. Access tokens are kept in
// memory until they expire; the refresh token is decrypted only here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent } from "@/lib/calendar/ics";
import type { Database } from "@/lib/database.types";
import { listEvents } from "./calendar";
import { googleConfig } from "./config";
import { decryptToken } from "./crypto";
import { GoogleError, refreshAccessToken } from "./oauth";

export interface GoogleState {
  /** Connected Google address (null: not connected). */
  email: string | null;
  /** Connected, but Google refuses the access now (revoked, password changed): reconnect. */
  broken: boolean;
  events: CalendarEvent[] | null;
}

const tokens = new Map<string, { token: string; until: number }>();

export async function googleEvents(
  supabase: SupabaseClient<Database>,
  userId: string,
  from: Date,
  to: Date,
): Promise<GoogleState> {
  const { data, error } = await supabase.from("google_connections").select("google_email, refresh_token").maybeSingle();
  if (error) throw new Error(`Could not load the Google connection (${error.code})`);
  if (!data) return { email: null, broken: false, events: null };
  const cfg = googleConfig();
  if (!cfg) return { email: data.google_email, broken: false, events: null };

  const refresh = decryptToken(data.refresh_token, cfg.tokenKey);
  if (!refresh) return { email: data.google_email, broken: true, events: null };
  try {
    let cached = tokens.get(userId);
    if (!cached || cached.until < Date.now()) {
      const t = await refreshAccessToken(cfg, refresh);
      cached = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
      if (tokens.size > 500) tokens.clear();
      tokens.set(userId, cached);
    }
    return { email: data.google_email, broken: false, events: await listEvents(cfg, cached.token, from, to) };
  } catch (e) {
    tokens.delete(userId);
    // invalid_grant / 401: the access was revoked or expired for good.
    const revoked = e instanceof GoogleError && (e.code === "invalid_grant" || e.status === 401);
    if (!revoked) console.error("[google] calendar read failed", e instanceof GoogleError ? { code: e.code, status: e.status } : "unknown");
    return { email: data.google_email, broken: revoked, events: null };
  }
}

/** Forget a person's cached access token (after disconnecting). */
export const forgetGoogleToken = (userId: string): boolean => tokens.delete(userId);
