// "Download PDF" (browser only): renders the #exp sheet (see ExportSheet) with
// html2pdf.js and saves it as a normal browser download. html2pdf.js (+ jsPDF,
// html2canvas) is ~1 MB minified, so it is loaded on first use. If it cannot
// load, the print dialog opens instead: the print CSS in globals.css prints only #exp.

/**
 * The prototype's html2pdf settings (one A4 page at 96 dpi = 794×1123 px, no
 * margin, JPEG at 2×), except `pagebreak`. The prototype used
 * `{ mode: ["css", "avoid-all"], avoid: ".s" }`, but html2pdf's avoid test
 * (`floor(bottom / page) !== floor(top / page)`) sees the full-bleed cover,
 * exactly one page tall, as split and pushes it down: page 1 came out blank.
 * The same avoidance scoped to the memo body keeps sections (and every line in
 * them) whole and leaves the cover alone.
 */
export const PDF_OPTIONS = {
  margin: 0,
  image: { type: "jpeg" as const, quality: 0.95 },
  html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
  jsPDF: {
    unit: "px",
    format: [794, 1123] as [number, number],
    orientation: "portrait" as const,
    // Without it jsPDF converts "px" with 96/72 instead of 72/96: pages ~1.8× A4.
    hotfixes: ["px_scaling"],
  },
  pagebreak: { mode: ["css"], avoid: [".s", ".body *"] },
};

/** Delay before print(), so the caller's toast ("use Print…") shows first (prototype: 400 ms). */
export const PRINT_DELAY_MS = 400;

type Html2Pdf = typeof import("html2pdf.js").default;

async function loadHtml2pdf(): Promise<Html2Pdf> {
  const mod: unknown = await import("html2pdf.js");
  // The package is a UMD bundle: depending on the bundler's CommonJS interop the
  // function is the module's default export or the default of that default.
  const d = (mod as { default?: unknown }).default ?? mod;
  const fn = typeof d === "function" ? d : (d as { default?: unknown } | null)?.default;
  if (typeof fn !== "function") throw new Error("html2pdf.js: unexpected module shape");
  return fn as Html2Pdf;
}

/**
 * html2pdf clones the element it is given, id included, into an invisible
 * overlay; `#exp{position:fixed;left:-10000px}` then pushes the clone out of
 * the captured area too. That is why the prototype's own PDFs came out as one
 * blank page. A detached copy put back in the flow renders correctly, and the
 * real sheet never moves on screen.
 */
export function inFlowCopy(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.style.position = "static";
  copy.style.left = "0";
  return copy;
}

/** Fonts and the cover image must be ready, or html2canvas draws fallbacks / a blank cover. */
async function whenReady(el: HTMLElement): Promise<void> {
  if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
  await Promise.all(Array.from(el.querySelectorAll("img"), (img) => img.decode().catch(() => undefined)));
}

/**
 * Saves `el` (the #exp sheet) as `filename`.
 * - "saved": the download was handed to the browser;
 * - "print": html2pdf.js could not be loaded; window.print() runs after PRINT_DELAY_MS;
 * - "failed": rendering failed (the caller can offer print instead).
 */
export async function downloadPdf(el: HTMLElement, filename: string): Promise<"saved" | "print" | "failed"> {
  let html2pdf: Html2Pdf;
  try {
    html2pdf = await loadHtml2pdf();
  } catch {
    setTimeout(() => window.print(), PRINT_DELAY_MS);
    return "print";
  }
  try {
    await whenReady(el);
    await html2pdf().set(PDF_OPTIONS).from(inFlowCopy(el)).save(filename);
    return "saved";
  } catch (e) {
    console.error("PDF export failed", e);
    return "failed";
  }
}
