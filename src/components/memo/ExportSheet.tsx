"use client";
// The PDF sheet `#exp` (prototype buildExport): designed cover + memo body,
// kept off-screen by globals.css. It is a portal straight into <body> because
// the print CSS hides `body>*:not(#exp)`, and it only renders on the client.
//
// Usage in the editor:
//   <ExportSheet team={team} lang={lang} title={title} content={content} answers={answers} />
//   const el = getExportSheet();
//   if (el) await downloadPdf(el, pdfFileName(memo));
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { type ExportMemo, exportSheetHTML } from "@/lib/memo/export";

export const EXPORT_SHEET_ID = "exp";

/** The mounted sheet element, or null (server, or before the first client render). */
export function getExportSheet(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById(EXPORT_SHEET_ID);
}

const noSubscribe = () => () => {};

export function ExportSheet(props: ExportMemo) {
  // false during SSR and hydration, true afterwards: no document.body before that.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  // Rebuilt on every render (a few KB of string) so a PDF taken right after a
  // keystroke is never stale; React only touches the DOM when the HTML changed.
  return createPortal(
    <div id={EXPORT_SHEET_ID} aria-hidden="true" dangerouslySetInnerHTML={{ __html: exportSheetHTML(props) }} />,
    document.body,
  );
}
