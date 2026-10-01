// Next.js 16 proxy (formerly middleware): refreshes the Supabase session on
// every request and sends signed-out visitors to /login. See
// src/lib/supabase/proxy.ts and docs/ARCHITECTURE.md §3.
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except build output, the favicon, team covers and image files.
    "/((?!_next/static|_next/image|favicon\\.ico|covers/|.*\\.(?:avif|gif|ico|jpe?g|png|svg|webp)$).*)",
  ],
};
