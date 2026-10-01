"use client";
// Unexpected errors (e.g. Supabase unreachable): the app's hero and one card
// with a retry, instead of Next's default page. Details stay in server logs.
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { BackIcon } from "@/components/list/icons";
import { AppFrame } from "@/components/shell/AppFrame";
import { DEFAULT_LANG, type Lang, doc, isLang, ui } from "@/lib/content";
import "@/styles/login.css";

function cookieLang(): Lang {
  const m = document.cookie.match(/(?:^|; )bxh-lang=(\w+)/);
  return m && isLang(m[1]) ? m[1] : DEFAULT_LANG;
}
const noSubscribe = () => () => {};

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Server render uses the default; the client reads the cookie (no hydration mismatch).
  const lang = useSyncExternalStore(noSubscribe, cookieLang, () => DEFAULT_LANG);
  useEffect(() => {
    console.error(error);
  }, [error]);
  const u = ui(lang);
  return (
    <AppFrame lang={lang} team="ops" title={[u.memo, "BoxHero"]} tag={doc(lang).tag} wrapClassName="solo">
      <main className="sheet solo-card">
        <h2 className="solo-h">{u.errorH}</h2>
        <div className="intro">
          <p>{u.errorMsg}</p>
        </div>
        <button type="button" className="btn primary solo-btn" onClick={() => retry()}>
          <span className="l">{u.retry}</span>
        </button>
        <Link href="/" className="btn ghost solo-btn">
          <span className="l">
            <BackIcon />
            {u.backToList}
          </span>
        </Link>
      </main>
    </AppFrame>
  );
}
