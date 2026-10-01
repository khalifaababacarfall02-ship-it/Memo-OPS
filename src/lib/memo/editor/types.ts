// Props shared by the editor pages (Server Components) and the editor (Client Component).
import type { Lang, Team } from "@/lib/content";
import type { MemoContent, MemoStatus } from "@/lib/memo/model";

export interface EditorMemo {
  /** null: a new memo, stored on the first edit. */
  id: string | null;
  team: Team;
  /** The memo's own language (exports); set from the UI language on each edit. */
  lang: Lang;
  title: string;
  content: MemoContent;
  authorId: string;
  deciderId: string | null;
  status: MemoStatus;
  asanaTaskGid: string | null;
  decidedAt: string | null;
  /** null for a new memo. */
  updatedAt: string | null;
}

export interface EditorViewer {
  id: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  /** Teams the viewer belongs to: a non-admin creates memos only in these. */
  teams: Team[];
}

/** Whether `viewer` may create a memo in `team` (mirrors the memos insert policy). */
export const canCreateIn = (viewer: { isAdmin: boolean; teams: readonly Team[] }, team: Team): boolean =>
  viewer.isAdmin || viewer.teams.includes(team);
