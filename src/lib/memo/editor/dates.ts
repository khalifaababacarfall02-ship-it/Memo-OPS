// Dates in the rail, formatted in the reader's own time zone (so only on the
// client: the server's zone would differ and break hydration).
import type { Lang } from "@/lib/content";

const locale = (lang: Lang) => (lang === "fr" ? "fr-FR" : "en-GB");

const valid = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The prototype's fmtDate(): "29 septembre à 09:00", "29 September at 09:00". */
export function fmtDate(iso: string | null | undefined, lang: Lang): string {
  const d = valid(iso);
  return d ? d.toLocaleString(locale(lang), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
}

/** A day for "Décidé le …": "29 septembre 2026", "29 September 2026". */
export function fmtDay(iso: string | null | undefined, lang: Lang): string {
  const d = valid(iso);
  return d ? d.toLocaleDateString(locale(lang), { day: "numeric", month: "long", year: "numeric" }) : "";
}
