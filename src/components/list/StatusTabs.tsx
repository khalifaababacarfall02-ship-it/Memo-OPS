// Status filter under the search field: All (everything but archived), then
// each status. Links, so they work without JavaScript and keep team and search;
// the current one is marked with aria-current.
import Link from "next/link";
import { type Lang, ui } from "@/lib/content";
import { type ListFilters, STATUS_FILTERS, listHref } from "./params";

export function StatusTabs({ lang, filters }: { lang: Lang; filters: ListFilters }) {
  const u = ui(lang);
  return (
    <nav className="lst-tabs" aria-label={u.statusL}>
      {STATUS_FILTERS.map((s) => (
        <Link
          key={s}
          href={listHref({ ...filters, status: s })}
          aria-current={s === filters.status ? "page" : undefined}
          data-status={s}
          scroll={false}
          prefetch={false}
        >
          {s === "all" ? u.allStatuses : u.status[s]}
        </Link>
      ))}
    </nav>
  );
}
