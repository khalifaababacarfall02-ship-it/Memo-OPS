"use client";
import { useTransition } from "react";
import { setLang } from "@/app/actions/lang";
import type { Lang } from "@/lib/content";

/** Français / English pill switch in the hero (prototype `.lang`). */
export function LangSwitch({ lang }: { lang: Lang }) {
  const [, startTransition] = useTransition();
  const choose = (l: Lang) => {
    if (l !== lang) startTransition(() => setLang(l));
  };
  return (
    <div className="lang" role="group" aria-label={lang === "fr" ? "Langue" : "Language"}>
      <button type="button" data-l="fr" aria-pressed={lang === "fr"} onClick={() => choose("fr")}>
        Français
      </button>
      <button type="button" data-l="en" aria-pressed={lang === "en"} onClick={() => choose("en")}>
        English
      </button>
    </div>
  );
}
