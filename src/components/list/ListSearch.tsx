"use client";
// Search field at the top of the list. Typing updates `q` in the URL after a
// pause (router.replace: no history entry per keystroke, the field keeps its
// focus); Enter searches at once. Without JavaScript it is a plain GET form.
//
// A tab, pill or link clicked during the pause wins: the pending search is
// held back until that page is shown, then applied on top of its filters
// (never on the filters of the page where the typing started).
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { MAX_SEARCH_LENGTH } from "@/lib/search";
import { type ListFilters, listHref } from "./params";

const DEBOUNCE_MS = 300;

// What starts a navigation to other filters: links, and the hero's team pills
// (buttons that push a URL).
const NAVIGATES = "a[href], .poles button[data-p]";

type Timer = RefObject<ReturnType<typeof setTimeout> | undefined>;

/** Stops the pending search; true when there was one. */
function cancelTimer(timer: Timer): boolean {
  const pending = timer.current !== undefined;
  clearTimeout(timer.current);
  timer.current = undefined;
  return pending;
}

export function ListSearch({
  filters,
  label,
  placeholder,
}: {
  filters: ListFilters;
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(filters.q);
  // `q` we last sent to the URL, and the last `q` the page gave us.
  const [sent, setSent] = useState(filters.q);
  const [seen, setSeen] = useState(filters.q);
  const timer: Timer = useRef(undefined);
  // The current page's filters and the last `q` sent, for the timer: it runs
  // later, possibly on another page, and must not use the filters of its render.
  const latest = useRef({ filters, sent });
  // A search held back by a click on a link or pill, applied once that page is shown.
  const held = useRef<string | null>(null);

  // The URL changed without us (back button, a team pill): show its text,
  // unless it is only the echo of what is being typed.
  if (filters.q !== seen) {
    setSeen(filters.q);
    if (filters.q !== sent && filters.q !== value.trim()) {
      setValue(filters.q);
      setSent(filters.q);
    }
  }

  useEffect(() => {
    latest.current = { filters, sent };
  });

  const search = (text: string) => {
    cancelTimer(timer);
    held.current = null;
    const q = text.trim();
    if (q === latest.current.sent) return;
    latest.current.sent = q;
    setSent(q);
    // Changing the search goes back to the first page of results.
    startTransition(() => router.replace(listHref({ ...latest.current.filters, q }), { scroll: false }));
  };

  useEffect(() => {
    // A click that navigates while a search is pending: the click wins and the
    // search waits for the new page (below). Capture phase: before the link's own handler.
    const onClick = (e: MouseEvent) => {
      if (timer.current === undefined || e.button !== 0) return;
      // Opening a link elsewhere (new tab or window) leaves this page as it is.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const nav = target?.closest(NAVIGATES);
      if (!nav || nav.closest(".lst-search") || nav.getAttribute("target") === "_blank") return;
      const text = (document.getElementById("lst-q") as HTMLInputElement | null)?.value ?? "";
      if (cancelTimer(timer)) held.current = text;
    };
    // Back/forward: the history entry wins, the typing is dropped.
    const onPopState = () => {
      cancelTimer(timer);
      held.current = null;
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      cancelTimer(timer);
    };
  }, [timer]);

  // A new page from the server (the clicked tab or pill): apply the held search to it.
  const applyHeld = useEffectEvent(() => {
    if (held.current !== null) search(held.current);
  });
  useEffect(() => {
    applyHeld();
  }, [filters]);

  return (
    <form
      className="titlefield lst-search"
      role="search"
      action="/"
      method="get"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        search(value);
      }}
    >
      <label htmlFor="lst-q">{label}</label>
      <div className="lst-field">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id="lst-q"
          name="q"
          type="search"
          value={value}
          placeholder={placeholder}
          maxLength={MAX_SEARCH_LENGTH}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            held.current = null;
            cancelTimer(timer);
            timer.current = setTimeout(() => search(next), DEBOUNCE_MS);
          }}
        />
      </div>
      {/* Kept by the no-JavaScript submit. */}
      {filters.team && <input type="hidden" name="team" value={filters.team} />}
      {filters.status !== "all" && <input type="hidden" name="status" value={filters.status} />}
    </form>
  );
}
