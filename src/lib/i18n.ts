import "server-only";
// Interface language: the FR/EN switch stores it in a cookie. French is the
// default, like the prototype.
import { cookies } from "next/headers";
import { DEFAULT_LANG, type Lang, isLang } from "@/lib/content";

export const LANG_COOKIE = "bxh-lang";

export async function getLang(): Promise<Lang> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(value) ? value : DEFAULT_LANG;
}
