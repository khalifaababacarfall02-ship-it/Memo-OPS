import { afterEach, describe, expect, it, vi } from "vitest";
import { copyRich } from "@/lib/memo/clipboard";

class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

function stubClipboard(clipboard: Partial<Clipboard> | undefined, withItem = true) {
  vi.stubGlobal("navigator", clipboard ? { clipboard } : {});
  vi.stubGlobal("ClipboardItem", withItem ? FakeClipboardItem : undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyRich (same strategy as the prototype's copy button)", () => {
  it("writes text/html and text/plain together", async () => {
    const write = vi.fn<(items: ClipboardItems) => Promise<void>>(async () => {});
    const writeText = vi.fn(async () => {});
    stubClipboard({ write, writeText });
    await expect(copyRich("<h1>A &amp; B</h1>", "A & B")).resolves.toBe("copied");
    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0][0][0] as unknown as FakeClipboardItem;
    expect(Object.keys(item.items)).toEqual(["text/html", "text/plain"]);
    expect(await item.items["text/html"].text()).toBe("<h1>A &amp; B</h1>");
    expect(item.items["text/html"].type).toBe("text/html");
    expect(await item.items["text/plain"].text()).toBe("A & B");
  });

  it("falls back to plain text when rich copy is refused", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard({ write: vi.fn(async () => Promise.reject(new Error("NotAllowedError"))), writeText });
    await expect(copyRich("<p>x</p>", "x")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("x");
  });

  it("falls back to plain text without ClipboardItem (older Firefox)", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard({ write: vi.fn(), writeText }, false);
    await expect(copyRich("<p>x</p>", "x")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("x");
  });

  it('asks for a manual copy when the clipboard is unavailable or refuses', async () => {
    stubClipboard(undefined);
    await expect(copyRich("<p>x</p>", "x")).resolves.toBe("manual");
    stubClipboard({
      write: vi.fn(async () => Promise.reject(new Error("denied"))),
      writeText: vi.fn(async () => Promise.reject(new Error("denied"))),
    });
    await expect(copyRich("<p>x</p>", "x")).resolves.toBe("manual");
  });
});
