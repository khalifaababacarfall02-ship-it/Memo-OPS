"use client";
// The prototype's toast: one message at a time, bottom centre, 2.6 s.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((m: string) => {
    setMessage(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={show ? "toast show" : "toast"} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
