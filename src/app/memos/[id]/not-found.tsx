// A memo that does not exist or that the viewer may not read (RLS): the same
// message in both cases, on the shared 404 card.
import type { Metadata } from "next";
import { NotFoundCard, notFoundTitle } from "@/components/notfound/NotFoundCard";
import { ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: notFoundTitle(ui(await getLang()).notFound) };
}

export default async function MemoNotFound() {
  const lang = await getLang();
  return <NotFoundCard lang={lang} message={ui(lang).notFound} />;
}
