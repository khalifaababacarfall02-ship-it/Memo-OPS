"use client";
// Magic-link form: the address goes to the sendMagicLink Server Action, which
// answers with "sent" or an error code; the texts come from the server page.
import { useActionState } from "react";
import { type LoginState, sendMagicLink } from "@/app/login/actions";
import type { LoginErrorCode } from "@/lib/auth/login-error";

export interface LoginTexts {
  loginIntro: string;
  emailL: string;
  sendLink: string;
  sending: string;
  /** With an {email} token. */
  linkSent: string;
  linkSentHint: string;
  errors: Record<LoginErrorCode, string>;
}

const IDLE: LoginState = { status: "idle" };

export function LoginForm({
  next,
  placeholder,
  initialError,
  t,
}: {
  /** Where to go once signed in (already checked by safeNext). */
  next: string;
  placeholder?: string;
  /** Message from the URL (?error=…), shown until the form is sent. */
  initialError: string | null;
  t: LoginTexts;
}) {
  const [state, action, pending] = useActionState(sendMagicLink, IDLE);
  const error = state.status === "error" ? t.errors[state.code] : state.status === "idle" ? initialError : null;

  return (
    <form action={action} className="login-form" noValidate>
      <div className="intro">
        <p>{t.loginIntro}</p>
      </div>
      <label htmlFor="login-email">{t.emailL}</label>
      <input
        id="login-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={320}
        placeholder={placeholder}
        // React resets the form after the action: keep what was typed.
        defaultValue={state.status === "idle" ? "" : state.email}
        aria-invalid={state.status === "error" && (state.code === "badEmail" || state.code === "badDomain")}
        aria-describedby="login-msg"
      />
      {next !== "/" && <input type="hidden" name="next" value={next} />}
      <button type="submit" className="btn primary" disabled={pending}>
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
            <rect x="2" y="4" width="20" height="16" rx="2.5" />
            <path d="m22 7-10 6L2 7" />
          </svg>
          {pending ? t.sending : t.sendLink}
        </span>
      </button>
      <div id="login-msg" className="login-live" role="status" aria-live="polite">
        {state.status === "sent" ? (
          <div className="login-msg ok">
            {/* fmt() without importing the whole content file into the browser bundle. */}
            <p>
              <b>{t.linkSent.replace("{email}", state.email)}</b>
            </p>
            <p>{t.linkSentHint}</p>
          </div>
        ) : error ? (
          <div className="login-msg err">
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </form>
  );
}
