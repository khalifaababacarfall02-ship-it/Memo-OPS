// Dates in the list and the rail, formatted like the prototype's fmtDate():
// "29 septembre à 09:00" / "29 September at 09:00".
import type { Lang } from "@/lib/content";

// Rendered on the server, which runs in UTC: show BoxHero's time instead
// (the prototype used the browser's clock, in Paris for the team).
export const DISPLAY_TIME_ZONE = "Europe/Paris";

export function fmtDate(lang: Lang, iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  });
}
