// 404 for unknown URLs and notFound() calls (a memo that does not exist or is
// not readable): the app's hero and one card with the way back to the list.
import Link from "next/link";
import { BackIcon } from "@/components/list/icons";
import { AppFrame } from "@/components/shell/AppFrame";
import { getViewer } from "@/lib/auth/viewer";
import { doc, ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import "@/styles/login.css";

export default async function NotFound() {
  const lang = await getLang();
  // Signed-out visitors normally never get here (the proxy sends them to /login).
  const viewer = await getViewer();
  const u = ui(lang);
  return (
    <AppFrame lang={lang} team="ops" title={[u.memo, "BoxHero"]} tag={doc(lang).tag} viewer={viewer} wrapClassName="solo">
      <main className="sheet solo-card">
        <h2 className="solo-h">404</h2>
        <div className="intro">
          <p>{u.notFound}</p>
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
