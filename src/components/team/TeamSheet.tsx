"use client";
// The /team sheet: the viewer's display name, then everyone with their teams
// and admin flag. Admins toggle memberships and admin rights (optimistic,
// rolled back with a toast when refused); everyone else sees the same list
// read-only. Writes go through the browser client: RLS and the guard
// triggers decide (only admins write team_members and is_admin; the last
// admin cannot be removed).
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useToast } from "@/components/shell/Toast";
import { type Lang, TEAMS, type Team, fmt, teamColors, ui } from "@/lib/content";
import { createClient } from "@/lib/supabase/client";
import { AccessCodeDialog, type IssuedCode, issueAccessCode } from "./AccessCode";
import {
  NAME_MAX,
  type Person,
  type WriteErrorKey,
  checkDisplayName,
  displayName,
  withAdmin,
  withName,
  withTeam,
  writeErrorKey,
} from "./team-logic";

type Tint = React.CSSProperties & { "--tc"?: string };
const tint = (team: Team): Tint => ({ "--tc": teamColors(team).acc });

export function TeamSheet({
  lang,
  viewerId,
  viewerName,
  canEdit,
  people: initialPeople,
}: {
  lang: Lang;
  viewerId: string;
  viewerName: string;
  /** The viewer is an admin. */
  canEdit: boolean;
  people: Person[];
}) {
  const u = ui(lang);
  const toast = useToast();
  const router = useRouter();
  const [people, setPeople] = useState(initialPeople);
  // One write at a time per checkbox: a second click waits for the first answer.
  const pending = useRef(new Set<string>());
  // Forgotten password: an admin gives the person a new access code.
  const [issued, setIssued] = useState<IssuedCode | null>(null);

  async function newCode(p: Person) {
    const code = await issueAccessCode(p.email);
    if (!code) {
      toast(u.codeFailed);
      return;
    }
    setIssued({ email: p.email, who: displayName(p), code });
  }

  async function run(key: string, apply: (on: boolean) => void, on: boolean, write: () => Promise<WriteErrorKey | null>) {
    if (!canEdit || pending.current.has(key)) return false;
    pending.current.add(key);
    apply(on);
    let err: WriteErrorKey | null;
    try {
      err = await write();
    } catch {
      err = "saveError";
    }
    pending.current.delete(key);
    if (err) {
      apply(!on);
      toast(u[err]);
      return false;
    }
    toast(u.teamSaved);
    return true;
  }

  function toggleTeam(p: Person, team: Team, on: boolean) {
    const supabase = createClient();
    void run(`${p.id}:${team}`, (v) => setPeople((ps) => withTeam(ps, p.id, team, v)), on, async () => {
      if (on) {
        const { data, error } = await supabase.from("team_members").insert({ user_id: p.id, team }).select("user_id");
        // 23505: someone added it meanwhile, which is what we wanted.
        if (error) return error.code === "23505" ? null : writeErrorKey(error);
        return data?.length ? null : "notAllowed";
      }
      const { data, error } = await supabase
        .from("team_members")
        .delete()
        .eq("user_id", p.id)
        .eq("team", team)
        .select("user_id");
      if (error) return writeErrorKey(error);
      if (data?.length) return null;
      // RLS hides a refused delete (0 rows, no error): already gone, or not allowed?
      const { data: still, error: e2 } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("user_id", p.id)
        .eq("team", team)
        .maybeSingle();
      if (e2) return "saveError";
      return still ? "notAllowed" : null;
    });
  }

  async function toggleAdmin(p: Person, on: boolean) {
    const supabase = createClient();
    const ok = await run(`${p.id}:admin`, (v) => setPeople((ps) => withAdmin(ps, p.id, v)), on, async () => {
      // Only this column: the guard refuses other changes to someone else's row.
      const { data, error } = await supabase.from("profiles").update({ is_admin: on }).eq("id", p.id).select("id");
      if (error) return writeErrorKey(error);
      return data?.length ? null : "notAllowed";
    });
    // Gave up their own rights: re-render the page (and the hero link) read-only.
    if (ok && p.id === viewerId && !on) router.refresh();
  }

  return (
    <>
      <NameField
        lang={lang}
        viewerId={viewerId}
        initial={viewerName}
        onSaved={(name) => setPeople((ps) => withName(ps, viewerId, name))}
      />

      <section className="sec tm-sec" aria-labelledby="tmPeopleH">
        <h2 id="tmPeopleH">{u.teamH}</h2>
        <div className="tm-people">
          <table className="tm-table">
            <thead>
              <tr>
                <th scope="col">{u.nameL}</th>
                {TEAMS.map((t) => (
                  <th scope="col" key={t} style={tint(t)}>
                    <span className="tm-dot" aria-hidden="true"></span>
                    {u.poles[t]}
                  </th>
                ))}
                <th scope="col" className="tm-adm">
                  {u.adminL}
                </th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const me = p.id === viewerId;
                const nameId = `tm-n-${p.id}`;
                const named = p.fullName.trim() !== "";
                return (
                  <tr key={p.id} className={me ? "me" : undefined} data-email={p.email}>
                    <th scope="row" className="tm-who">
                      <span className="tm-name">
                        <b id={nameId}>{displayName(p)}</b>
                        {me && <span className="tm-you">{u.you}</span>}
                      </span>
                      {named && <span className="tm-mail">{p.email}</span>}
                      {p.teams.length === 0 && <span className="tm-none">{u.noTeamYet}</span>}
                      {canEdit && (
                        <button
                          type="button"
                          className="tm-code"
                          aria-label={fmt(u.newCodeL, { who: displayName(p) })}
                          onClick={() => void newCode(p)}
                        >
                          {u.newCode}
                        </button>
                      )}
                    </th>
                    {TEAMS.map((t) => (
                      <td key={t}>
                        <label className="tm-check" style={tint(t)}>
                          <input
                            type="checkbox"
                            checked={p.teams.includes(t)}
                            disabled={!canEdit}
                            aria-describedby={nameId}
                            onChange={(e) => toggleTeam(p, t, e.target.checked)}
                          />
                          <span className="tm-lab">{u.poles[t]}</span>
                        </label>
                      </td>
                    ))}
                    <td className="tm-adm">
                      <label className="tm-check tm-admin">
                        <input
                          type="checkbox"
                          checked={p.isAdmin}
                          disabled={!canEdit}
                          aria-describedby={nameId}
                          onChange={(e) => void toggleAdmin(p, e.target.checked)}
                        />
                        <span className="tm-lab">{u.adminL}</span>
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <AccessCodeDialog lang={lang} issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}

/** The viewer's own profiles.full_name, saved on Enter or when leaving the field. */
function NameField({
  lang,
  viewerId,
  initial,
  onSaved,
}: {
  lang: Lang;
  viewerId: string;
  initial: string;
  onSaved: (name: string) => void;
}) {
  const u = ui(lang);
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const saved = useRef(initial);
  const saving = useRef(false);

  async function save() {
    if (saving.current) return;
    const check = checkDisplayName(value);
    if (!check.ok) {
      setInvalid(true);
      toast(check.reason === "empty" ? u.nameRequired : u.saveError);
      return;
    }
    setInvalid(false);
    setValue(check.value);
    if (check.value === saved.current) return;
    saving.current = true;
    let err: WriteErrorKey | null;
    try {
      const { data, error } = await createClient()
        .from("profiles")
        .update({ full_name: check.value })
        .eq("id", viewerId)
        .select("full_name");
      err = error ? writeErrorKey(error) : data?.length ? null : "notAllowed";
    } catch {
      err = "saveError";
    }
    saving.current = false;
    if (err) {
      toast(u[err]);
      return;
    }
    saved.current = check.value;
    onSaved(check.value);
    toast(u.profileSaved);
  }

  return (
    <form
      className="titlefield tm-namefield"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="tmName">{u.profileNameL}</label>
      <input
        id="tmName"
        name="full_name"
        autoComplete="name"
        maxLength={NAME_MAX}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setValue(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue(saved.current);
            setInvalid(false);
          }
        }}
      />
    </form>
  );
}
