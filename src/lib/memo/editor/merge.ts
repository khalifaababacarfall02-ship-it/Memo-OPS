// Three-way merge of the author's document when it was also changed
// elsewhere (another tab or device): `base` is the version both sides started
// from (the last one this editor knows was stored), `local` what was typed
// here, `server` what is stored now. Per top-level field, per header/section
// index and per row id (actions, requests, questions — ids are stable): the
// side that changed wins; when both changed the same field differently the
// local text is kept and `conflict` is set (the editor warns once).
import type { ActionRow, FullMemoContent, MemoContent, NeedRow, QuestionRow } from "@/lib/memo/model";
import type { DocSnapshot } from "./payload";

export interface MergeResult {
  doc: DocSnapshot;
  /** Both sides changed the same field (local kept), or a row edited on one side was removed on the other. */
  conflict: boolean;
}

type Four = [string, string, string, string];

class Merger {
  conflict = false;

  /** One value: the side that changed it, else local (warning when both changed it differently). */
  pick<T>(base: T, local: T, server: T, warn = true): T {
    if (Object.is(local, server)) return local;
    if (Object.is(local, base)) return server;
    if (Object.is(server, base)) return local;
    if (warn) this.conflict = true;
    return local;
  }

  four(base: Four, local: Four, server: Four): Four {
    return [0, 1, 2, 3].map((i) => this.pick(base[i], local[i], server[i])) as Four;
  }

  rows<R extends { id: string }>(base: R[], local: R[], server: R[], fields: readonly (keyof R)[]): R[] {
    const B = new Map(base.map((r) => [r.id, r]));
    const L = new Map(local.map((r) => [r.id, r]));
    const S = new Map(server.map((r) => [r.id, r]));
    const changed = (a: R, b: R) => fields.some((f) => !Object.is(a[f], b[f]));

    // The server's rows, in the server's order, merged field by field.
    const out: R[] = [];
    for (const s of server) {
      const b = B.get(s.id);
      const l = L.get(s.id);
      if (!b) {
        // New on the server (if local has it too, both come from a save this base predates: keep local).
        out.push(l ?? s);
        continue;
      }
      if (!l) {
        // Removed here: stays removed, but say so if it was edited on the server meanwhile.
        if (changed(b, s)) this.conflict = true;
        continue;
      }
      const row = { ...l };
      for (const f of fields) row[f] = this.pick(b[f], l[f], s[f]);
      out.push(row);
    }

    // Local rows the server does not have: added here, or removed on the server.
    let previous: string | null = null;
    for (const l of local) {
      if (!S.has(l.id)) {
        const b = B.get(l.id);
        const removedThere = b !== undefined;
        // A row removed on the server comes back only if it was edited here meanwhile.
        if (!removedThere || changed(b, l)) {
          if (removedThere) this.conflict = true;
          const at = previous === null ? -1 : out.findIndex((r) => r.id === previous);
          out.splice(at + 1, 0, l);
        } else continue;
      }
      if (out.some((r) => r.id === l.id)) previous = l.id;
    }
    return out;
  }

  content(base: MemoContent, local: MemoContent, server: MemoContent): MemoContent {
    if (local.kind !== server.kind) return server;
    // A base of another kind cannot happen (the team never changes); treat it as "nothing changed on the server".
    const b = base.kind === local.kind ? base : server;
    const common = {
      author: this.pick(b.author, local.author, server.author),
      meta: this.four(b.meta, local.meta, server.meta),
      s: this.four(b.s, local.s, server.s),
    };
    if (local.kind === "mini" && server.kind === "mini" && b.kind === "mini") {
      return { kind: "mini", ...common, works: this.pick(b.works, local.works, server.works) };
    }
    const bm = b as FullMemoContent;
    const lm = local as FullMemoContent;
    const sm = server as FullMemoContent;
    return {
      kind: "memo",
      ...common,
      acts: this.rows<ActionRow>(bm.acts, lm.acts, sm.acts, ["action", "owner", "due"]),
      needs: this.rows<NeedRow>(bm.needs, lm.needs, sm.needs, ["done", "text"]),
      res: this.pick(bm.res, lm.res, sm.res),
      qs: this.rows<QuestionRow>(bm.qs, lm.qs, sm.qs, ["q"]),
    };
  }
}

export function mergeDocs(base: DocSnapshot, local: DocSnapshot, server: DocSnapshot): MergeResult {
  const m = new Merger();
  const doc: DocSnapshot = {
    title: m.pick(base.title, local.title, server.title),
    deciderId: m.pick(base.deciderId, local.deciderId, server.deciderId),
    // The memo's language follows whoever edited last: not worth a warning.
    lang: m.pick(base.lang, local.lang, server.lang, false),
    content: m.content(base.content, local.content, server.content),
  };
  return { doc, conflict: m.conflict };
}

/** Same title, decider, language and content (row ids included). */
export function sameDoc(a: DocSnapshot, b: DocSnapshot): boolean {
  if (a === b) return true;
  return (
    a.title === b.title &&
    a.deciderId === b.deciderId &&
    a.lang === b.lang &&
    JSON.stringify(a.content) === JSON.stringify(b.content)
  );
}
