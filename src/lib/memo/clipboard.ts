// "Copy for Asana" (browser only): the memo as rich HTML and plain text on the
// clipboard, with the prototype's fallbacks. "manual" means the browser
// refused both: the caller shows the text in the modal for a manual copy.

export async function copyRich(html: string, text: string): Promise<"copied" | "manual"> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof ClipboardItem !== "undefined") {
      // Asana keeps headings and lists from text/html; other apps take text/plain.
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return "copied";
    }
    throw new Error("ClipboardItem unavailable");
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // Insecure context, permission denied or no clipboard at all.
    }
  }
  return "manual";
}
