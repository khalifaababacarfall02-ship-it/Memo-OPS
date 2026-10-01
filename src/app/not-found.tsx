// 404 for unknown URLs (and notFound() calls outside /memos/[id]): the shared
// 404 card, with the generic message.
import type { Metadata } from "next";
import { NotFoundCard, notFoundTitle } from "@/components/notfound/NotFoundCard";
import { ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: notFoundTitle(ui(await getLang()).pageNotFound) };
}

export default async function NotFound() {
  const lang = await getLang();
  return <NotFoundCard lang={lang} message={ui(lang).pageNotFound} />;
}
