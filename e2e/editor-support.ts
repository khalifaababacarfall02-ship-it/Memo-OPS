// Helpers shared by the editor-*.spec.ts files (users and data use the `fe-`
// prefix; see e2e/support.ts for signing in without email).
import { type Browser, type BrowserContextOptions, type Page, expect, test } from "@playwright/test";
import { ui } from "../src/lib/content";
import type { Json } from "../src/lib/database.types";
import { admin, signIn } from "./support";

export const fr = ui("fr");
export const en = ui("en");

export const memoUrl = /\/memos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const idFromUrl = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;
export const toast = (page: Page) => page.locator(".toast.show");

/** A signed-in page for `email` in its own browser context, on `path`. */
export async function as(
  browser: Browser,
  email: string,
  path: string,
  opts: { lang?: "fr" | "en"; clipboard?: boolean; context?: BrowserContextOptions; waitSheet?: boolean } = {},
): Promise<Page> {
  const baseURL = test.info().project.use.baseURL!;
  const ctx = await browser.newContext({
    baseURL,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1280, height: 900 },
    permissions: opts.clipboard ? ["clipboard-read", "clipboard-write"] : [],
    ...opts.context,
  });
  await ctx.addCookies([{ name: "bxh-lang", value: opts.lang ?? "fr", url: baseURL }]);
  const page = await ctx.newPage();
  await signIn(page, email, path);
  if (opts.waitSheet !== false) await expect(page.locator("#sheet")).toBeVisible();
  return page;
}

/** Wait until the autosave says everything is stored. */
export async function saved(page: Page, label = fr.savedAuto) {
  await expect(page.locator("#saveState")).toHaveText(label, { timeout: 10_000 });
}

export async function row(id: string) {
  const { data, error } = await admin().from("memos").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function memosOf(authorId: string) {
  const { data } = await admin().from("memos").select("id, title, content").eq("author_id", authorId);
  return data ?? [];
}

/** A full memo's content with stable ids. */
export function fullContent(over: Record<string, unknown> = {}): Json {
  return {
    kind: "memo",
    author: "Fe",
    meta: ["", "", "", ""],
    s: ["Pourquoi", "", "", ""],
    acts: [{ id: "a1", action: "Agir", owner: "", due: "" }],
    needs: [],
    res: "",
    qs: [
      { id: "q1", q: "Question 1 ?" },
      { id: "q2", q: "Question 2 ?" },
    ],
    ...over,
  } as Json;
}

/** Marks an element so a test can tell whether React replaced it (remount) or kept it. */
export const tag = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => ((el as HTMLElement & { __fe?: boolean }).__fe = true));
export const stillTagged = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => (el as HTMLElement & { __fe?: boolean }).__fe === true);
