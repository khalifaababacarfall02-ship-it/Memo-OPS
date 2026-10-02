"use client";
// The first sign-in form: name, and the pôle as a row of team-coloured choices
// (radio buttons) when the person is in none yet. Texts come from the page.
import { useActionState, useState } from "react";
import { type WelcomeState, completeWelcome } from "@/app/welcome/actions";

export interface WelcomeTexts {
  intro: string;
  nameL: string;
  poleL: string;
  /** Already in a pôle: the sentence that says which (null: they choose). */
  poleGiven: string | null;
  adminNote: string | null;
  go: string;
  saving: string;
  errors: Record<"nameRequired" | "welcomeNeedPole" | "saveError", string>;
}

export interface PoleChoice {
  key: string;
  label: string;
  color: string;
}

const IDLE: WelcomeState = { status: "idle" };

export function WelcomeForm({
  next,
  initialName,
  poles,
  t,
}: {
  next: string;
  initialName: string;
  /** Empty when the person already has a pôle. */
  poles: PoleChoice[];
  t: WelcomeTexts;
}) {
  const [state, action, pending] = useActionState(completeWelcome, IDLE);
  const [picked, setPicked] = useState<string | null>(null);
  // Controlled: React resets uncontrolled fields after each action, errors included.
  const [name, setName] = useState(initialName);
  const error = state.status === "error" ? t.errors[state.code] : null;

  return (
    <form action={action} className="login-form wl-form" noValidate>
      <div className="intro">
        <p>{t.intro}</p>
      </div>
      <label htmlFor="wl-name">{t.nameL}</label>
      <input
        id="wl-name"
        name="full_name"
        type="text"
        autoComplete="name"
        maxLength={120}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-invalid={state.status === "error" && state.code === "nameRequired"}
        aria-describedby="wl-msg"
      />
      {t.poleGiven ? (
        <p className="wl-given">{t.poleGiven}</p>
      ) : (
        <fieldset className="wl-poles" aria-describedby="wl-msg">
          <legend>{t.poleL}</legend>
          {t.adminNote && <p className="wl-note">{t.adminNote}</p>}
          <div className="wl-pole-row">
            {poles.map((p) => (
              <label
                key={p.key}
                className={picked === p.key ? "wl-pole on" : "wl-pole"}
                style={{ "--tc": p.color } as React.CSSProperties}
              >
                <input
                  type="radio"
                  name="team"
                  value={p.key}
                  checked={picked === p.key}
                  onChange={() => setPicked(p.key)}
                />
                <i aria-hidden="true" />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {next !== "/" && <input type="hidden" name="next" value={next} />}
      <button type="submit" className="btn primary" id="wlGo" disabled={pending}>
        <span className="l">{pending ? t.saving : t.go}</span>
      </button>
      <div id="wl-msg" className="login-live" role="status" aria-live="polite">
        {error ? (
          <div className="login-msg err">
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </form>
  );
}
