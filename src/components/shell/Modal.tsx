"use client";
// The prototype's `.modal` overlay: closes on Escape and on a click outside the
// box, keeps Tab inside the box, and gives focus back on close. Rendered in
// <body> like the prototype's #gmodal/#modal, so it never inherits the colours
// of where it is used (e.g. the hero's white text).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const noSubscribe = () => () => {};

export function Modal({
  open,
  onClose,
  className,
  labelledBy,
  initialFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Extra class on the `.box` (e.g. "guidebox"). */
  className?: string;
  labelledBy?: string;
  /** Element focused when the modal opens (defaults to the box). */
  initialFocus?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? box.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !box.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, initialFocus]);

  if (!mounted) return null;
  return createPortal(
    <div
      className={open ? "modal open" : "modal"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div
          ref={box}
          className={className ? `box ${className}` : "box"}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
        >
          {children}
        </div>
      )}
    </div>,
    document.body,
  );
}
