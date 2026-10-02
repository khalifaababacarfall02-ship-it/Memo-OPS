import "server-only";
// Supabase client for Server Components, Server Actions and Route Handlers.
// Create one per request: it reads and refreshes the auth cookies of the
// current request. The session refresh itself happens in src/proxy.ts.
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from "@/lib/env";

export async function createClient(): Promise<SupabaseClient<Database>> {
  assertSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: src/proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}
