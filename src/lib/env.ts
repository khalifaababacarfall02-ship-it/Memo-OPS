// Environment access. NEXT_PUBLIC_* values are inlined at build time and are
// safe for the browser. Server-only settings are read where they are used:
// ALLOWED_EMAIL_DOMAINS in src/lib/auth/allowed-email.ts, ASANA_* in src/lib/asana/.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/** Publishable (sb_publishable_…) or legacy anon key. Safe in the browser: RLS protects the data. */
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function assertSupabaseEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY). Copy .env.example to .env.local.",
    );
  }
}
