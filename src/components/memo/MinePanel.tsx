"use client";
// "Mes mémos" (prototype renderMemos()): the viewer's recent memos, the
// current one highlighted, a two-step delete ("Sûr ?") where allowed, and a
// link to the full list.
import Link from "next/link";
import { useState } from "react";
import { type Lang, ui } from "@/lib/content";
import { useMounted } from "@/lib/memo/editor/client-state";
import { fmtDate } from "@/lib/memo/editor/dates";
import type { MineRow } from "@/lib/memo/editor/view";

export function MinePanel({
  lang,
  rows,
  onOpen,
  onDelete,
}: {
  lang: Lang;
  rows: MineRow[];
  onOpen: (row: MineRow) => void;
  onDelete: (row: MineRow) => void;
}) {
  const u = ui(lang);
  const mounted = useMounted();
  // The row whose "Supprimer" was clicked once (prototype: class "sure", text "Sûr ?").
  const [sure, setSure] = useState<string | null>(null);
  const keyOf = (r: MineRow) => r.id ?? "new";

  return (
    <div className="panel">
      <h3 id="lTitle">{u.mine}</h3>
      {rows.length ? (
        <ul className="memos" id="memos">
          {rows.map((r) => {
            const k = keyOf(r);
            return (
              <li key={k} className={r.current ? "cur" : ""}>
                <button type="button" className="open" data-open={r.id ?? ""} onClick={() => onOpen(r)}>
                  <b>{r.title || u.untitled}</b>
                  {/* A no-break space keeps the line until the date can be formatted in the reader's zone. */}
                  <span>{mounted ? fmtDate(r.at, lang) : "\u00a0"}</span>
                </button>
                {r.deletable && (
                  <button
                    type="button"
                    className={sure === k ? "rm sure" : "rm"}
                    data-rm={r.id ?? ""}
                    onClick={() => {
                      if (sure !== k) {
                        setSure(k);
                        return;
                      }
                      setSure(null);
                      onDelete(r);
                    }}
                  >
                    {sure === k ? u.sure : u.del}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mine-none">{u.mineNone}</p>
      )}
      <Link href="/" className="mine-all">
        {u.allMemos}
      </Link>
    </div>
  );
}
