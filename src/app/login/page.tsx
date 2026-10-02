// Sign-in page: address + password, or "choose my password" with an access
// code (?setup=1&email=… opens that form, as in the message admins send).
// Public (the proxy lets it through and sends signed-in visitors on).
import type { Metadata } from "next";
import { LoginForm } from "@/components/login/LoginForm";
import { SoloStyles } from "@/components/notfound/SoloStyles";
import { AppFrame } from "@/components/shell/AppFrame";
import { normalizeEmail } from "@/lib/auth/allowed-email";
import { safeNext } from "@/lib/auth/redirect";
import { doc, ui } from "@/lib/content";
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

  // /login?error=auth (an old email link, expired or used), ?error=profile (no
  // profile row); anything else is reported as a generic failure.
  const code = first(params.error);
  const initialError = !code ? null : code === "auth" ? u.authError : code === "profile" ? u.profileMissing : u.loginError;

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
        <LoginForm
          next={safeNext(first(params.next))}
          initialMode={first(params.setup) === "1" ? "setup" : "signIn"}
          initialEmail={normalizeEmail(first(params.email) ?? "").slice(0, 320)}
          initialError={initialError}
          t={{
            loginH: u.loginH,
            setupH: u.setupH,
            loginIntro: u.loginIntro,
            setupIntro: u.setupIntro,
            emailL: u.emailL,
            emailPh: u.emailPh,
            passwordL: u.passwordL,
            codeL: u.codeL,
            newPasswordL: u.newPasswordL,
            confirmPasswordL: u.confirmPasswordL,
            signIn: u.signIn,
            signingIn: u.signingIn,
            setPassword: u.setPassword,
            settingPassword: u.settingPassword,
            firstTime: u.firstTime,
            haveAccount: u.haveAccount,
            showPassword: u.showPassword,
            hidePassword: u.hidePassword,
            errors: {
              badEmail: u.badEmail,
              needPassword: u.needPassword,
              badCredentials: u.badCredentials,
              rateLimited: u.rateLimited,
              loginError: u.loginError,
              needCode: u.needCode,
              codeInvalid: u.codeInvalid,
              codeExpired: u.codeExpired,
              codeLocked: u.codeLocked,
              weakPassword: u.weakPassword,
              mismatch: u.mismatch,
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
