"use client";
// The prototype's `.modal` overlay: closes on Escape and on a click outside the box.
import { useEffect, useRef } from "react";

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
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, initialFocus]);

  return (
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
    </div>
  );
}
