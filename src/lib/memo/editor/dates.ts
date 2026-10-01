// Dates in the editor, in BoxHero's time zone like the list (one formatter
// for both: src/components/list/format.ts), so the rail and the list agree.
import { DISPLAY_TIME_ZONE, fmtDate as listFmtDate } from "@/components/list/format";
import type { Lang } from "@/lib/content";

/** The prototype's fmtDate(): "29 septembre à 09:00", "29 September at 09:00" (Europe/Paris). */
export const fmtDate = (iso: string | null | undefined, lang: Lang): string => listFmtDate(lang, iso);

/** A day for "Décidé le …": "29 septembre 2026", "29 September 2026" (Europe/Paris). */
export function fmtDay(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  });
}
