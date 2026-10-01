"use client";
// Keeps the list fresh after browser Back/Forward. Next.js serves a page it
// already rendered from its client cache on back/forward navigation (no server
// request), so a memo renamed in the editor kept its old title in the list and
// the rails. The server renders this with a new token each time: a token seen
// before means the page was restored from that cache, so it is fetched again
// (router.refresh keeps the scroll position and the search field).
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// Tokens of the renders shown in this tab (gone on a full reload, like the cache).
const shown = new Set<string>();

export function RefreshOnRestore({ token }: { token: string }) {
  const router = useRouter();
  // The token this instance already handled (React may run an effect twice in development).
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (handled.current === token) return;
    handled.current = token;
    if (shown.has(token)) router.refresh();
    else shown.add(token);
  }, [router, token]);

  useEffect(() => {
    // The browser's own back/forward cache restores the whole page as it was.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  return null;
}
