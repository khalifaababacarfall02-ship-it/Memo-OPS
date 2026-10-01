"use client";
// A <textarea> that grows with its text, like the prototype's grow():
// height auto, then scrollHeight + 2 (the 1px borders). Runs on mount, on
// every value change (typing or new content from outside), when the web
// fonts arrive and when the width changes.
import { useEffect, useLayoutEffect, useRef } from "react";

export function grow(t: HTMLTextAreaElement | null): void {
  if (!t) return;
  t.style.height = "auto";
  t.style.height = t.scrollHeight + 2 + "px";
}

export function GrowArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { value } = props;

  useLayoutEffect(() => {
    grow(ref.current);
  }, [value]);

  useEffect(() => {
    let alive = true;
    let width = ref.current?.clientWidth ?? 0;
    const regrow = () => {
      if (alive) grow(ref.current);
    };
    void document.fonts?.ready.then(regrow);
    const onResize = () => {
      const w = ref.current?.clientWidth ?? 0;
      if (w !== width) {
        width = w;
        regrow();
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <textarea ref={ref} {...props} />;
}
