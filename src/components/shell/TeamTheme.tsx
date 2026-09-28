"use client";
// Applies the team colours to <html> as well (prototype `applyDA`), so that
// elements rendered outside the page wrapper — the PDF sheet portal, the
// toast, modals — use them too. The wrapper carries the same variables for
// the server-rendered first paint.
import { useEffect } from "react";
import { type Team, teamStyle } from "@/lib/content";

export function TeamTheme({ team }: { team: Team }) {
  useEffect(() => {
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(teamStyle(team))) root.setProperty(k, v);
  }, [team]);
  return null;
}
