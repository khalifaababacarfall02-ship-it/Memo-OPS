import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// html2pdf's chainable worker, recording the calls.
function fakeWorker(save: () => Promise<void> = async () => {}) {
  const calls: { set?: unknown; from?: unknown; save?: unknown } = {};
  const w = {
    set: (o: unknown) => ((calls.set = o), w),
    from: (el: unknown) => ((calls.from = el), w),
    save: (name: unknown) => ((calls.save = name), save()),
  };
  return { html2pdf: vi.fn(() => w), calls };
}

// Just enough of the #exp element for downloadPdf.
const fakeSheet = (): HTMLElement =>
  ({ id: "exp", style: {}, querySelectorAll: () => [], cloneNode: () => fakeSheet() }) as unknown as HTMLElement;
const sheet = fakeSheet();
const print = vi.fn();

async function loadPdf() {
  return import("@/lib/memo/pdf");
}

beforeEach(() => {
  vi.resetModules();
  print.mockReset();
  vi.stubGlobal("window", { print });
});
afterEach(() => {
  vi.doUnmock("html2pdf.js");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("downloadPdf", () => {
  it("uses the prototype's html2pdf options, with page-break avoidance scoped to the body", async () => {
    const golden = JSON.parse(readFileSync("tests/fixtures/prototype-exports.json", "utf8"));
    const { PDF_OPTIONS } = await loadPdf();
    // Captured from the prototype's PDF button: only `pagebreak` differs (see pdf.ts).
    expect(golden.pdfOptions.pagebreak).toEqual({ mode: ["css", "avoid-all"], avoid: ".s" });
    expect({ ...PDF_OPTIONS, pagebreak: golden.pdfOptions.pagebreak }).toEqual(golden.pdfOptions);
    expect(PDF_OPTIONS.pagebreak).toEqual({ mode: ["css"], avoid: [".s", ".body *"] });
  });

  it("renders an in-flow copy of the sheet and saves it under the given name", async () => {
    const { html2pdf, calls } = fakeWorker();
    vi.doMock("html2pdf.js", () => ({ default: html2pdf }));
    const { downloadPdf, PDF_OPTIONS } = await loadPdf();
    await expect(downloadPdf(sheet, "Memo_X.pdf")).resolves.toBe("saved");
    expect(calls.set).toBe(PDF_OPTIONS);
    expect(calls.save).toBe("Memo_X.pdf");
    // Not the live #exp (fixed at left:-10000px) but a detached copy back in the flow.
    expect(calls.from).not.toBe(sheet);
    expect((calls.from as { id: string }).id).toBe("exp");
    expect((calls.from as HTMLElement).style).toMatchObject({ position: "static", left: "0" });
    expect(print).not.toHaveBeenCalled();
  });

  it("accepts the doubly wrapped default of the UMD bundle", async () => {
    const { html2pdf, calls } = fakeWorker();
    vi.doMock("html2pdf.js", () => ({ default: { default: html2pdf } }));
    const { downloadPdf } = await loadPdf();
    await expect(downloadPdf(sheet, "a.pdf")).resolves.toBe("saved");
    expect(calls.save).toBe("a.pdf");
  });

  it("opens the print dialog (after the toast delay) when html2pdf cannot load", async () => {
    vi.doMock("html2pdf.js", () => {
      throw new Error("ChunkLoadError");
    });
    vi.useFakeTimers();
    const { downloadPdf, PRINT_DELAY_MS } = await loadPdf();
    await expect(downloadPdf(sheet, "a.pdf")).resolves.toBe("print");
    expect(print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PRINT_DELAY_MS);
    expect(print).toHaveBeenCalledOnce();
  });

  it("reports a rendering failure", async () => {
    const { html2pdf } = fakeWorker(async () => Promise.reject(new Error("canvas too large")));
    vi.doMock("html2pdf.js", () => ({ default: html2pdf }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { downloadPdf } = await loadPdf();
    await expect(downloadPdf(sheet, "a.pdf")).resolves.toBe("failed");
    expect(error).toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
