// The list's URL: `/?team=…&status=…&q=…`. Pure (no Next.js, no Supabase), so
// the Server Component, the search field and the tests share it.
import { type Team, isTeam } from "@/lib/content";
import { type MemoStatus, MEMO_STATUSES, isStatus } from "@/lib/memo/model";
import { MAX_SEARCH_LENGTH } from "@/lib/search";

/** `all` = every status except archived (the default). */
export type StatusFilter = "all" | MemoStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = ["all", ...MEMO_STATUSES];

export interface ListFilters {
  /** null = every team. */
  team: Team | null;
  status: StatusFilter;
  /** The search text as typed (trimmed); normalised only when the query is built. */
  q: string;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Room for accents and ligatures that normalisation shrinks or expands.
const MAX_Q_LENGTH = MAX_SEARCH_LENGTH * 2;

/** Invalid or unknown values are ignored (they fall back to the defaults). */
export function parseListParams(params: RawSearchParams): ListFilters {
  const team = first(params.team);
  const status = first(params.status);
  const q = first(params.q);
  return {
    team: isTeam(team) ? team : null,
    status: isStatus(status) ? status : "all",
    q: typeof q === "string" ? Array.from(q.trim()).slice(0, MAX_Q_LENGTH).join("").trim() : "",
  };
}

/** "/", "/?team=ops", "/?team=ops&status=decided&q=retours": defaults are left out. */
export function listHref({ team, status, q }: ListFilters): string {
  const params = new URLSearchParams();
  if (team) params.set("team", team);
  if (status !== "all") params.set("status", status);
  const text = q.trim();
  if (text) params.set("q", text);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
