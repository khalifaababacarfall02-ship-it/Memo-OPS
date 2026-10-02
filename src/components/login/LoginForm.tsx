"use client";
// Sign-in card: address + password. A link switches to "choose my password"
// (first time, or forgotten password): address + the access code an admin gave
// + the new password twice. Both go to Server Actions (src/app/login/actions.ts);
// the texts come from the server page.
import { useActionState, useState } from "react";
import { type SetupState, type SignInState, setPasswordWithCode, signIn } from "@/app/login/actions";
import type { SetupErrorCode, SignInErrorCode } from "@/lib/auth/login-error";

export interface LoginTexts {
  loginH: string;
  setupH: string;
  loginIntro: string;
  setupIntro: string;
  emailL: string;
  emailPh: string;
  passwordL: string;
  codeL: string;
  newPasswordL: string;
  confirmPasswordL: string;
  signIn: string;
  signingIn: string;
  setPassword: string;
  settingPassword: string;
  firstTime: string;
  haveAccount: string;
  showPassword: string;
  hidePassword: string;
  errors: Record<SignInErrorCode | SetupErrorCode, string>;
}

const IDLE_SIGN_IN: SignInState = { status: "idle" };
const IDLE_SETUP: SetupState = { status: "idle" };

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  t,
  invalid,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  t: LoginTexts;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="lg-field">
      <label htmlFor={id}>{label}</label>
      <div className="lg-pw">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          maxLength={200}
          aria-invalid={invalid || undefined}
          aria-describedby="login-msg"
        />
        <button type="button" className="lg-show" onClick={() => setShown((s) => !s)} aria-controls={id}>
          {shown ? t.hidePassword : t.showPassword}
        </button>
      </div>
    </div>
  );
}

export function LoginForm({
  next,
  initialMode,
  initialEmail,
  initialError,
  t,
}: {
  /** Where to go once signed in (already checked by safeNext). */
  next: string;
  initialMode: "signIn" | "setup";
  initialEmail: string;
  /** Message from the URL (?error=…), shown until a form is sent. */
  initialError: string | null;
  t: LoginTexts;
}) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [accessCode, setAccessCode] = useState("");
  const [signInState, signInAction, signingIn] = useActionState(signIn, IDLE_SIGN_IN);
  const [setupState, setupAction, settingUp] = useActionState(setPasswordWithCode, IDLE_SETUP);

  const state = mode === "signIn" ? signInState : setupState;
  const error =
    state.status === "error" ? t.errors[state.code] : signInState.status === "idle" && setupState.status === "idle" ? initialError : null;
  const code = state.status === "error" ? state.code : null;

  const emailField = (
    <div className="lg-field">
      <label htmlFor="login-email">{t.emailL}</label>
      <input
        id="login-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={320}
        placeholder={t.emailPh}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={code === "badEmail" || code === "badCredentials" || undefined}
        aria-describedby="login-msg"
      />
    </div>
  );

  return (
    <div className="login-form">
      <h2 className="solo-h">{mode === "signIn" ? t.loginH : t.setupH}</h2>
      {mode === "signIn" ? (
        <form action={signInAction} noValidate key="signIn">
          <p className="lg-intro">{t.loginIntro}</p>
          {emailField}
          <PasswordField
            id="login-password"
            name="password"
            label={t.passwordL}
            autoComplete="current-password"
            t={t}
            invalid={code === "needPassword" || code === "badCredentials"}
          />
          {next !== "/" && <input type="hidden" name="next" value={next} />}
          <button type="submit" className="btn primary lg-submit" id="loginSubmit" disabled={signingIn}>
            <span className="l">{signingIn ? t.signingIn : t.signIn}</span>
          </button>
          <button type="button" className="lg-switch" id="loginSetup" onClick={() => setMode("setup")}>
            {t.firstTime}
          </button>
        </form>
      ) : (
        <form action={setupAction} noValidate key="setup">
          <p className="lg-intro">{t.setupIntro}</p>
          {emailField}
          <div className="lg-field">
            <label htmlFor="login-code">{t.codeL}</label>
            <input
              id="login-code"
              name="code"
              type="text"
              className="lg-code"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              placeholder="ABCD-EFGH"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              aria-invalid={code === "needCode" || code === "codeInvalid" || code === "codeExpired" || code === "codeLocked" || undefined}
              aria-describedby="login-msg"
            />
          </div>
          <PasswordField
            id="login-new-password"
            name="password"
            label={t.newPasswordL}
            autoComplete="new-password"
            t={t}
            invalid={code === "weakPassword"}
          />
          <PasswordField
            id="login-confirm"
            name="confirm"
            label={t.confirmPasswordL}
            autoComplete="new-password"
            t={t}
            invalid={code === "mismatch"}
          />
          {next !== "/" && <input type="hidden" name="next" value={next} />}
          <button type="submit" className="btn primary lg-submit" id="setupSubmit" disabled={settingUp}>
            <span className="l">{settingUp ? t.settingPassword : t.setPassword}</span>
          </button>
          <button type="button" className="lg-switch" id="loginBack" onClick={() => setMode("signIn")}>
            {t.haveAccount}
          </button>
        </form>
      )}
      <div id="login-msg" className="login-live" role="status" aria-live="polite">
        {error ? (
          <div className="login-msg err">
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
