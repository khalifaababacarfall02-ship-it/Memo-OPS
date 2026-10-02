"use client";
// The prototype's guide (`openGuide()`): 4 steps, the parts of the memo, the rules.
import { useRef } from "react";
import { type Lang, strings } from "@/lib/content";
import { Modal } from "./Modal";

export function GuideModal({ lang, open, onClose }: { lang: Lang; open: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const { guide: g, ui: u } = strings(lang);
  return (
    <Modal open={open} onClose={onClose} className="guidebox" labelledBy="guide-t1" initialFocus={close}>
      <div>
        <h3 id="guide-t1">{g.t1}</h3>
        <ol className="gsteps">
          {g.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <h3>{g.t2}</h3>
        <div className="gparts">
          {g.parts.map(([k, v]) => (
            <div key={k}>
              <b>{k}</b>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <h3>{g.t3}</h3>
        <div className="gchips">
          {g.rules.map((r) => (
            <span key={r}>{r}</span>
          ))}
        </div>
      </div>
      <button ref={close} type="button" className="btn ghost" style={{ marginTop: 14 }} onClick={onClose}>
        {u.gClose}
      </button>
    </Modal>
  );
}
