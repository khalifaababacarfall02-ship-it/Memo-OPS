"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { isLang } from "@/lib/content";
import { LANG_COOKIE } from "@/lib/i18n";

/** FR/EN switch: remember the choice for a year and re-render the current page. */
export async function setLang(lang: string): Promise<void> {
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  refresh();
}
