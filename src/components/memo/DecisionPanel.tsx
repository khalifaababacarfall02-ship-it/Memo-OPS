"use client";
// Rail panel for the decision workflow (new in the app): status, decision
// maker, and the buttons the viewer may use (canTransition). Built from the
// prototype's panel and button classes so it looks native.
import { type Lang, fmt, ui } from "@/lib/content";
import type { Person } from "@/lib/memo/editor/people";
import type { WorkflowButton } from "@/lib/memo/editor/view";
import type { MemoStatus, Transition } from "@/lib/memo/model";
import { ArchiveIcon, BackIcon, DecideIcon, ReopenIcon, SendIcon } from "./icons";

const ICONS: Record<Transition, () => React.JSX.Element> = {
  submit: SendIcon,
  decide: DecideIcon,
  withdraw: BackIcon,
  reopen: ReopenIcon,
  restore: BackIcon,
  archive: ArchiveIcon,
};

export function DecisionPanel({
  lang,
  status,
  people,
  deciderId,
  deciderName,
  editable,
  buttons,
  busy,
  decidedOn,
  readOnlyNote,
  onDecider,
  onTransition,
}: {
  lang: Lang;
  status: MemoStatus;
  people: Person[];
  deciderId: string | null;
  deciderName: string | null;
  /** The author may pick the decision maker. */
  editable: boolean;
  buttons: WorkflowButton[];
  busy: boolean;
  /** Formatted day, when decided. */
  decidedOn: string | null;
  /** Why the memo is read-only, if it is. */
  readOnlyNote: string | null;
  onDecider: (id: string | null) => void;
  onTransition: (t: Transition) => void;
}) {
  const u = ui(lang);
  return (
    <div className="panel decision" id="decision">
      <h3 className="dhead">
        {u.decisionH}
        <span className={`badge st-${status}`} id="memoStatus">
          {u.status[status]}
        </span>
      </h3>
      {editable ? (
        <>
          <label className="dlab" htmlFor="fDecider">
            {u.deciderL}
          </label>
          <select id="fDecider" className="dsel" value={deciderId ?? ""} onChange={(e) => onDecider(e.target.value || null)}>
            <option value="">{u.deciderPh}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <div className="dlab">{u.deciderL}</div>
          <div className={deciderName ? "dval" : "dval none"} id="fDecider">
            {deciderName ?? u.noDecider}
          </div>
        </>
      )}
      {decidedOn && <p className="dnote">{fmt(u.decidedOn, { date: decidedOn })}</p>}
      {buttons.length > 0 && (
        <div className="dacts">
          {buttons.map((b) => {
            const Icon = ICONS[b.transition];
            return (
              <button
                key={b.transition}
                type="button"
                className={b.primary ? "btn acc" : "btn ghost"}
                data-t={b.transition}
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => onTransition(b.transition)}
              >
                <span className="l">
                  <Icon />
                  {u[b.label]}
                </span>
                {b.sub && <small>{u[b.sub]}</small>}
              </button>
            );
          })}
        </div>
      )}
      {readOnlyNote && <p className="dnote ro">{readOnlyNote}</p>}
    </div>
  );
}
