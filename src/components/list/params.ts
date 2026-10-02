// The list's URL: `/?team=…&status=…&q=…[&limit=…]`. Pure (no Next.js, no Supabase), so
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

/** Rows of the first page, and how many more each "Show more" adds. */
export const LIST_PAGE = 200;
/** Upper bound for `limit` (a URL can ask for anything). */
export const MAX_LIST_LIMIT = 10_000;

/**
 * How many rows to show: `limit` rounded up to whole pages, LIST_PAGE by
 * default. Kept apart from the filters: changing a filter or the search goes
 * back to the first page.
 */
export function parseListLimit(params: RawSearchParams): number {
  const raw = first(params.limit);
  const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : LIST_PAGE;
  return Math.min(MAX_LIST_LIMIT, Math.max(LIST_PAGE, Math.ceil(n / LIST_PAGE) * LIST_PAGE));
}

/**
 * "/", "/?team=ops", "/?team=ops&status=decided&q=retours", "…&limit=400":
 * defaults are left out.
 */
export function listHref({ team, status, q }: ListFilters, limit = LIST_PAGE): string {
  const params = new URLSearchParams();
  if (team) params.set("team", team);
  if (status !== "all") params.set("status", status);
  const text = q.trim();
  if (text) params.set("q", text);
  if (limit > LIST_PAGE) params.set("limit", String(limit));
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
