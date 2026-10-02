"use client";
import { useTransition } from "react";
import { setLang } from "@/app/actions/lang";
import { type Lang, ui } from "@/lib/content";
import { useToast } from "./Toast";

/** Français / English pill switch in the hero (prototype `.lang`). */
export function LangSwitch({ lang }: { lang: Lang }) {
  const [, startTransition] = useTransition();
  const toast = useToast();
  const choose = (l: Lang) => {
    if (l === lang) return;
    startTransition(async () => {
      // A failed switch must not replace the page (and an open memo) with the error page.
      try {
        await setLang(l);
      } catch {
        toast(ui(lang).errorMsg);
      }
    });
  };
  return (
    <div className="lang" role="group" aria-label={ui(lang).langL}>
      <button type="button" data-l="fr" aria-pressed={lang === "fr"} onClick={() => choose("fr")}>
        Français
      </button>
      <button type="button" data-l="en" aria-pressed={lang === "en"} onClick={() => choose("en")}>
        English
      </button>
    </div>
  );
}
