"use client";
// Team pills + Guide button under the hero title (prototype `.poles`).
// Used as navigation (list filter, from a Server Component: pass `links`) or
// as a switch inside a Client Component (pass `onSelect`).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Lang, TEAMS, type Team, ui } from "@/lib/content";
import { GuideModal } from "./GuideModal";

export type PillKey = Team | "all";

export function TeamPills({
  lang,
  active,
  includeAll = false,
  links,
  onSelect,
}: {
  lang: Lang;
  /** Pressed pill; null when none is (e.g. a page that is not about one team). */
  active: PillKey | null;
  /** Prepend an "All" pill (list view). */
  includeAll?: boolean;
  /** Destination per pill. */
  links?: Partial<Record<PillKey, string>>;
  onSelect?: (key: PillKey) => void;
}) {
  const router = useRouter();
  const [guideOpen, setGuideOpen] = useState(false);
  const u = ui(lang);
  const keys: PillKey[] = includeAll ? ["all", ...TEAMS] : [...TEAMS];

  const select = (key: PillKey) => {
    if (onSelect) onSelect(key);
    else if (links?.[key]) router.push(links[key]!);
  };

  return (
    <>
      <div className="poles" id="poles" role="group" aria-label={u.teamsL}>
        {keys.map((k) => (
          <button key={k} type="button" data-p={k} aria-pressed={k === active} onClick={() => select(k)}>
            {k === "all" ? u.allTeams : u.poles[k]}
          </button>
        ))}
        <button type="button" className="guide" id="bGuide" onClick={() => setGuideOpen(true)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
          {u.guide}
        </button>
      </div>
      <GuideModal lang={lang} open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
