// Small browser-only stores for the editor, read with useSyncExternalStore so
// the server render (and hydration) use the defaults.
import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** false during SSR and hydration, true afterwards (dates in the reader's time zone). */
export const useMounted = (): boolean =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

// ---------- "Afficher les exemples", remembered per browser ----------

export const SHOW_EX_KEY = "bxh-show-examples";
const SHOW_EX_EVENT = "bxh-show-examples";
// Used when storage is blocked (private mode…): the choice then lasts for this page only.
let inMemory = true;

function readShowEx(): boolean {
  try {
    const v = window.localStorage.getItem(SHOW_EX_KEY);
    return v === null ? inMemory : v !== "0";
  } catch {
    return inMemory;
  }
}

function subscribeShowEx(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SHOW_EX_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SHOW_EX_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SHOW_EX_EVENT, onChange);
  };
}

export const useShowExamples = (): boolean =>
  useSyncExternalStore(
    subscribeShowEx,
    readShowEx,
    () => true,
  );

export function setShowExamples(show: boolean): void {
  inMemory = show;
  try {
    window.localStorage.setItem(SHOW_EX_KEY, show ? "1" : "0");
  } catch {
    // Not remembered across visits; `inMemory` and the event below still update this page.
  }
  window.dispatchEvent(new Event(SHOW_EX_EVENT));
}

// ---------- a fresh editor for "Nouveau mémo" on /memos/new ----------
// The /memos/new editor survives router.refresh() (FR/EN switch while its
// first save is in flight must not reset it), so it is not keyed by the
// server render. The editor's own navigations to a new memo at the same URL
// bump this counter, which keys a fresh one.

let newMemoVisit = 0;
const visitListeners = new Set<() => void>();

export function startFreshNewMemo(): void {
  newMemoVisit += 1;
  visitListeners.forEach((l) => l());
}

export const useNewMemoVisit = (): number =>
  useSyncExternalStore(
    (onChange) => {
      visitListeners.add(onChange);
      return () => {
        visitListeners.delete(onChange);
      };
    },
    () => newMemoVisit,
    () => 0,
  );
