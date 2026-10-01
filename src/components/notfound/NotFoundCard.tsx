// The 404 page, shared by unknown URLs (src/app/not-found.tsx) and memos that
// do not exist or cannot be read (src/app/memos/[id]/not-found.tsx): the app's
// hero and one centred card with the way back to the list. Only the message differs.
import Link from "next/link";
import { BackIcon } from "@/components/list/icons";
import { AppFrame } from "@/components/shell/AppFrame";
import { getViewer } from "@/lib/auth/viewer";
import { type Lang, doc, ui } from "@/lib/content";
import { SoloStyles } from "./SoloStyles";

/** Title of a 404 tab: the message without its final full stop. */
export const notFoundTitle = (message: string): string => message.replace(/[.!]$/u, "");

export async function NotFoundCard({ lang, message }: { lang: Lang; message: string }) {
  // Signed-out visitors normally never get here (the proxy sends them to /login).
  const viewer = await getViewer();
  const u = ui(lang);
  return (
    <AppFrame lang={lang} team="ops" title={[u.memo, "BoxHero"]} tag={doc(lang).tag} viewer={viewer} wrapClassName="solo">
      <main className="sheet solo-card">
        <SoloStyles />
        <h2 className="solo-h">404</h2>
        <div className="intro">
          <p>{message}</p>
        </div>
        <Link href="/" className="btn primary solo-btn">
          <span className="l">
            <BackIcon />
            {u.backToList}
          </span>
        </Link>
      </main>
    </AppFrame>
  );
}
