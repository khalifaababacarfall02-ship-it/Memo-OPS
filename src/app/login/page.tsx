// Sign-in page: one card under the hero, an email field, a magic link.
// Public (the proxy lets it through and sends signed-in visitors on).
import type { Metadata } from "next";
import { LoginForm } from "@/components/login/LoginForm";
import { SoloStyles } from "@/components/notfound/SoloStyles";
import { AppFrame } from "@/components/shell/AppFrame";
import { allowedDomains } from "@/lib/auth/allowed-email";
import { safeNext } from "@/lib/auth/redirect";
import { doc, fmt, ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import "@/styles/login.css";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  return { title: ui(await getLang()).loginH };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const lang = await getLang();
  const u = ui(lang);

  // /login?error=auth (link expired or used), ?error=profile (no profile row);
  // anything else is reported as a failed sending.
  const code = first(params.error);
  const initialError = !code ? null : code === "auth" ? u.authError : code === "profile" ? u.profileMissing : u.sendError;
  const domain = allowedDomains()[0];

  return (
    <AppFrame
      lang={lang}
      team="ops"
      title={[u.memo, "BoxHero"]}
      tag={doc(lang).tag}
      viewer={null}
      wrapClassName="solo"
    >
      <main className="sheet solo-card">
        <SoloStyles />
        <h2 className="solo-h">{u.loginH}</h2>
        <LoginForm
          next={safeNext(first(params.next))}
          placeholder={domain ? fmt(u.emailPh, { domain }) : undefined}
          initialError={initialError}
          t={{
            loginIntro: u.loginIntro,
            emailL: u.emailL,
            sendLink: u.sendLink,
            sending: u.sending,
            linkSent: u.linkSent,
            linkSentHint: u.linkSentHint,
            errors: {
              badEmail: u.badEmail,
              badDomain: u.badDomain,
              rateLimited: u.rateLimited,
              sendError: u.sendError,
            },
          }}
        />
        {code === "profile" && (
          // Signed in, but the account has no profile: the hero shows no account
          // menu here, so this is the only way to leave that session.
          <form action="/auth/signout" method="post" className="login-signout">
            <button type="submit" className="btn ghost">
              <span className="l">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                {u.signOut}
              </span>
            </button>
          </form>
        )}
      </main>
    </AppFrame>
  );
}
