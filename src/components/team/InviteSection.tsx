"use client";
// Admins only (/team): who may sign in. BoxHero uses personal addresses (Gmail,
// Proton), so each person is invited by email, optionally straight into a pôle.
// The list shows the invitations of people who have not signed in yet. Writes go
// through the browser client: RLS lets only admins touch public.invitations.
// Each invitation comes with a one-time access code (AccessCodeDialog) that the
// person uses to choose their password; "Nouveau code" gives another one.
import { useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/shell/Toast";
import { type Lang, MEMO_TEAMS, type Team, fmt, isTeam, teamColors, ui } from "@/lib/content";
import { isValidEmail, normalizeEmail } from "@/lib/auth/allowed-email";
import { createClient } from "@/lib/supabase/client";
import { AccessCodeDialog, type IssuedCode, issueAccessCode } from "./AccessCode";
import { writeErrorKey } from "./team-logic";

export interface PendingInvitation {
  email: string;
  team: Team | null;
}

const noSubscribe = () => () => {};

export function InviteSection({
  lang,
  pending: initialPending,
  members,
}: {
  lang: Lang;
  /** Invitations of people without an account yet, oldest first. */
  pending: PendingInvitation[];
  /** Emails that already have an account. */
  members: string[];
}) {
  const u = ui(lang);
  const toast = useToast();
  const [pending, setPending] = useState(initialPending);
  const [email, setEmail] = useState("");
  const [team, setTeam] = useState<Team | "">("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  // The address people sign in at (this deployment), for the intro text.
  const site = useSyncExternalStore(noSubscribe, () => window.location.host, () => "");

  async function invite() {
    if (busy) return;
    const value = normalizeEmail(email);
    if (!isValidEmail(value)) {
      setInvalid(true);
      toast(u.badEmail);
      return;
    }
    if (members.includes(value)) {
      toast(u.inviteAlready);
      return;
    }
    if (pending.some((p) => p.email === value)) {
      toast(u.inviteDup);
      return;
    }
    setBusy(true);
    try {
      const { error } = await createClient()
        .from("invitations")
        .insert({ email: value, team: team || null })
        .select("email");
      if (error) {
        toast(error.code === "23505" ? u.inviteDup : u[writeErrorKey(error)]);
        return;
      }
      setPending((ps) => [...ps, { email: value, team: team || null }]);
      setEmail("");
      setTeam("");
      toast(u.invited);
      await giveCode(value);
    } catch {
      toast(u.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function giveCode(address: string) {
    const code = await issueAccessCode(address);
    if (!code) {
      toast(u.codeFailed);
      return;
    }
    setIssued({ email: address, who: address, code });
  }

  async function remove(p: PendingInvitation) {
    try {
      const { data, error } = await createClient().from("invitations").delete().eq("email", p.email).select("email");
      if (error || !data?.length) {
        toast(u[writeErrorKey(error ?? { code: "42501" })]);
        return;
      }
      setPending((ps) => ps.filter((x) => x.email !== p.email));
      toast(u.inviteRemoved);
    } catch {
      toast(u.saveError);
    }
  }

  return (
    <section className="sec tm-sec tm-invite" aria-labelledby="tmInviteH">
      <h2 id="tmInviteH">{u.inviteH}</h2>
      <p className="tm-hint">{fmt(u.inviteIntro, { url: site || "…" })}</p>
      <form
        className="tm-inv-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <label className="tm-inv-field">
          <span>{u.inviteEmailL}</span>
          <input
            id="tmInviteEmail"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            placeholder={u.emailPh}
            value={email}
            maxLength={320}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              if (invalid) setInvalid(false);
            }}
          />
        </label>
        <label className="tm-inv-field tm-inv-team">
          <span>{u.invitePoleL}</span>
          <select id="tmInviteTeam" value={team} onChange={(e) => setTeam(isTeam(e.target.value) ? e.target.value : "")}>
            <option value="">{u.invitePoleAsk}</option>
            {MEMO_TEAMS.map((t) => (
              <option key={t} value={t}>
                {u.poles[t]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn acc tm-inv-btn" id="tmInviteBtn" disabled={busy}>
          <span className="l">{u.inviteBtn}</span>
        </button>
      </form>

      <h3 className="tm-inv-h">{u.invitePendingH}</h3>
      {pending.length === 0 ? (
        <p className="tm-hint" id="tmInviteNone">
          {u.inviteNone}
        </p>
      ) : (
        <ul className="tm-inv-list" id="tmInvites">
          {pending.map((p) => (
            <li key={p.email} data-email={p.email}>
              <span className="tm-inv-mail">{p.email}</span>
              {p.team && (
                <span className="tm-inv-pole" style={{ "--tc": teamColors(p.team).acc } as React.CSSProperties}>
                  <i aria-hidden="true" />
                  {u.poles[p.team]}
                </span>
              )}
              <button
                type="button"
                className="tm-inv-x tm-inv-code"
                aria-label={fmt(u.newCodeL, { who: p.email })}
                onClick={() => void giveCode(p.email)}
              >
                {u.newCode}
              </button>
              <button
                type="button"
                className="tm-inv-x"
                aria-label={fmt(u.inviteRemoveL, { email: p.email })}
                onClick={() => void remove(p)}
              >
                {u.inviteRemove}
              </button>
            </li>
          ))}
        </ul>
      )}
      <AccessCodeDialog lang={lang} issued={issued} onClose={() => setIssued(null)} />
    </section>
  );
}
