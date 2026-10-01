"use client";
// Search field at the top of the list. Typing updates `q` in the URL after a
// pause (router.replace: no history entry per keystroke, the field keeps its
// focus); Enter searches at once. Without JavaScript it is a plain GET form.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { MAX_SEARCH_LENGTH } from "@/lib/search";
import { type ListFilters, listHref } from "./params";

const DEBOUNCE_MS = 300;

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
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The URL changed without us (back button, a team pill): show its text,
  // unless it is only the echo of what is being typed.
  if (filters.q !== seen) {
    setSeen(filters.q);
    if (filters.q !== sent && filters.q !== value.trim()) {
      setValue(filters.q);
      setSent(filters.q);
    }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (text: string) => {
    clearTimeout(timer.current);
    const q = text.trim();
    if (q === sent) return;
    setSent(q);
    startTransition(() => router.replace(listHref({ ...filters, q }), { scroll: false }));
  };

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
            clearTimeout(timer.current);
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
