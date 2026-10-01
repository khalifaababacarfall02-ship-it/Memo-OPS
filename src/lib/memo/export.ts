// Every export of a memo, as pure string functions (no DOM: runs on the
// server for the Asana API and in the browser for copy and PDF):
// - "Copy for Asana": rich HTML (asanaHTML) + plain text (htmlToText),
// - the designed PDF sheet rendered into #exp (exportSheetHTML, pdfFileName),
// - phase 2 "Send to Asana": task name + html_notes (asanaTaskName, asanaTaskNotes).
// The first four reproduce the prototype byte for byte (golden tests in
// export.test.ts against tests/fixtures/prototype-exports.json).
import {
  type Lang,
  type Team,
  doc,
  esc as escAttr,
  heroTag,
  heroTitle,
  kindOf,
  metaFields,
  sectionsFor,
  signature,
  teamCover,
  teamLabel,
  ui,
} from "@/lib/content";
import { type FullMemoContent, type MemoContent, normalizeContent, titlePrefix } from "@/lib/memo/model";

export interface ExportMemo {
  team: Team;
  lang: Lang;
  title: string;
  content: MemoContent;
  /** Decision maker's answers (`memo_answers`), keyed by question id. */
  answers?: Record<string, string>;
}

// The prototype's esc(): unlike content.ts esc() it leaves quotes alone.
// Copy and PDF outputs must stay identical to the prototype, and they never
// put user text inside an attribute, so this is safe there.
const esc = (s: string | null | undefined): string =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Escaped text with newlines as <br> (the prototype's `p()`). */
const br = (s: string): string => esc(s).replace(/\n/g, "<br>");

/** The content, guaranteed to have the shape of the memo's team. */
const contentOf = (m: ExportMemo): MemoContent =>
  m.content.kind === kindOf(m.team) ? m.content : normalizeContent(m.team, m.content);

/** Answer to one question ("" when the decision maker has not answered). */
function answerOf(m: ExportMemo, questionId: string): string {
  const a = m.answers;
  if (!a || !Object.prototype.hasOwnProperty.call(a, questionId)) return "";
  const v = a[questionId];
  return typeof v === "string" ? v : "";
}

// The prototype's filters: an action row counts if any of its three cells has
// text, a request or a question only if its text does.
const filledActs = (c: FullMemoContent) => c.acts.filter((a) => (a.action + a.owner + a.due).trim());
const filledNeeds = (c: FullMemoContent) => c.needs.filter((n) => n.text.trim());
const filledQs = (c: FullMemoContent) => c.qs.filter((q) => q.q.trim());
const box = (done: boolean) => (done ? "☒" : "☐");

// ---------- Copy for Asana ----------

/** Rich HTML put on the clipboard by "Copy for Asana" (prototype `asanaHTML()`). */
export function asanaHTML(m: ExportMemo): string {
  const { lang, team } = m;
  const c = contentOf(m);
  const T = doc(lang);
  const u = ui(lang);
  let h =
    `<h1>${esc(titlePrefix(lang, team, "asana"))}${esc(m.title)}</h1>` +
    `<p>${metaFields(lang, team)
      .map((f, i) => `<strong>${esc(f.label)}</strong> ${esc(c.meta[i])}`)
      .join("<br>")}</p>`;
  sectionsFor(lang, team).forEach((s, i) => {
    h += `<h2>${esc(s.label)} · ${esc(s.question)}</h2>`;
    if (c.kind === "mini") {
      h += `<p>${br(c.s[i])}</p>`;
      if (i === 3 && c.works) h += `<p><strong>${u.worksIf} :</strong> ${esc(c.works)}</p>`;
      return;
    }
    if (i < 4) h += `<p>${br(c.s[i])}</p>`;
    if (i === 3) {
      const acts = filledActs(c);
      if (acts.length)
        h += `<p><strong>${esc(T.actL)}</strong></p><ol>${acts
          .map((a) => `<li>${esc(a.action)} · ${esc(a.owner)} · ${esc(a.due)}</li>`)
          .join("")}</ol>`;
      const needs = filledNeeds(c);
      if (needs.length)
        h += `<p><strong>${esc(T.needL)}</strong></p><ul>${needs
          .map((n) => `<li>${box(n.done)} ${esc(n.text)}</li>`)
          .join("")}</ul>`;
      if (c.res) h += `<p><strong>${u.res} :</strong> ${esc(c.res)}</p>`;
    }
    if (i === 4)
      h += `<ol>${filledQs(c)
        .map((q) => `<li>${esc(q.q)}<br>→ ${esc(answerOf(m, q.id))}</li>`)
        .join("")}</ol>`;
  });
  return h;
}

// Entities that asanaHTML() can produce (esc), plus the usual ones, decoded in
// a single pass so "&amp;lt;" becomes "&lt;" and not "<".
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/**
 * Plain-text version of asanaHTML() (prototype `htmlToText()`), without a DOM.
 * The prototype parsed the HTML into a <div> and read textContent; for the
 * markup asanaHTML() produces that means: line breaks after blocks and <br>,
 * CR/CRLF → LF (HTML input preprocessing), tags removed, entities decoded,
 * NUL dropped (the parser ignores it in body text), 3+ newlines collapsed.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(h1|h2|p|li)>/g, "</$1>\n")
      .replace(/<br>/g, "\n")
      .replace(/\r\n?/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\0/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- PDF sheet ----------

/**
 * Inner HTML of the PDF sheet `#exp` (prototype `buildExport()`): cover page
 * + memo body. Only difference: the cover image is `teamCover(team)` (or
 * `opts.coverSrc`) instead of an inline data URL.
 */
export function exportSheetHTML(m: ExportMemo, opts: { coverSrc?: string } = {}): string {
  const { lang, team } = m;
  const c = contentOf(m);
  const T = doc(lang);
  const u = ui(lang);
  const [t1, t2] = heroTitle(lang, team);
  let body =
    `<div class="h">BOXHERO</div><h1>${esc(titlePrefix(lang, team, "pdf"))}${esc(m.title)}</h1>` +
    `<div class="mt">${metaFields(lang, team)
      .map((f, i) => `<b>${esc(f.label)}</b><span>${esc(c.meta[i])}</span>`)
      .join("")}</div>`;
  sectionsFor(lang, team).forEach((s, i) => {
    let inner = "";
    if (c.kind === "mini") {
      inner = `<p>${br(c.s[i])}</p>` + (i === 3 && c.works ? `<p><b>${u.worksIf} :</b> ${esc(c.works)}</p>` : "");
    } else {
      if (i < 4) inner += `<p>${br(c.s[i])}</p>`;
      if (i === 3) {
        const acts = filledActs(c);
        if (acts.length)
          inner += `<p><b>${esc(T.actL)}</b></p><ol>${acts
            .map((a) => `<li>${esc(a.action)} · ${esc(a.owner)} · ${esc(a.due)}</li>`)
            .join("")}</ol>`;
        const needs = filledNeeds(c);
        if (needs.length)
          inner += `<p><b>${esc(T.needL)}</b></p><ul style="list-style:none;padding-left:0">${needs
            .map((n) => `<li>${box(n.done)} ${esc(n.text)}</li>`)
            .join("")}</ul>`;
        if (c.res) inner += `<p><b>${u.res} :</b> ${esc(c.res)}</p>`;
      }
      if (i === 4)
        inner += `<ol>${filledQs(c)
          .map((q) => `<li>${esc(q.q)}<br>→ ${esc(answerOf(m, q.id))}</li>`)
          .join("")}</ol>`;
    }
    body += `<div class="s"><h2>${esc(s.label)}</h2><p class="q">${esc(s.question)}</p>${inner}</div>`;
  });
  body += `<div class="ft">${esc(signature(lang))}</div>`;
  // "Created by": the author field, then the memo's date field if any.
  const date = c.meta[c.kind === "mini" ? 1 : 2];
  const cover = escAttr(opts.coverSrc ?? teamCover(team));
  return (
    `<div class="pg cover"><img src="${cover}" alt=""><div class="v"></div><div class="t">` +
    `<div class="w">BOXHERO</div><h1>${esc(t1)}<br>${esc(t2)}</h1><div class="tag">${esc(heroTag(lang, team))}</div>` +
    `<div class="who"><b>${u.prepared}</b>${esc(u.pole + teamLabel(lang, team))}<br><br>` +
    `<b>${u.created}</b>${esc(c.author || "")}${date ? " · " + esc(date) : ""}</div>` +
    `<div class="sig">${esc(signature(lang))}</div></div></div><div class="body">${body}</div>`
  );
}

/** "Memo_Fix_Amazon_returns_before_October.pdf" (title, or team label when untitled). */
export function pdfFileName(m: ExportMemo): string {
  return "Memo_" + (m.title || teamLabel(m.lang, m.team)).replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) + ".pdf";
}

// ---------- Asana API (phase 2) ----------

/** Task name: "MÉMO : Corriger les retours Amazon avant octobre", "AD: …". */
export function asanaTaskName(m: ExportMemo): string {
  const title = m.title.replace(/\s+/g, " ").trim();
  return titlePrefix(m.lang, m.team, "asana") + (title || teamLabel(m.lang, m.team));
}

// Asana rich text (tasks.html_notes). developers.asana.com was not reachable
// from the build machine; the rules below come from what Asana publishes
// elsewhere and are checked by export.test.ts:
// - Asana OpenAPI spec (github.com/Asana/openapi, defs/asana_oas.yaml): rich
//   text values "must be wrapped in <body></body> tags"; example
//   `<body>Mittens <em>really</em> likes the stuff from Humboldt.</body>`.
// - Asana's MCP server (create_task description): rich text supports headings
//   h1 and h2, marks strong, em, u, s, inline code, and lists ul / ol / li.
// - developers.asana.com/docs/rich-text (via search summary) and the forum
//   changelog "Code and quote blocks in rich text": <blockquote> and <pre> are
//   supported; <a href> links are supported (the API adds attributes to them on
//   read); headers, blockquote and pre may not be nested in list items, and
//   lists may not be nested in headers, blockquote or pre.
// - The document is parsed as XML (invalid input is rejected with a 400), there
//   is no <p> or <br>: line breaks are literal "\n" in the text.
// So: <body> root, h1/h2/strong/a/ol/ul/li only, list items on one line, text
// blocks separated by "\n", everything escaped, XML-invalid characters removed.

// Characters outside the XML 1.0 `Char` production (C0 controls except tab/LF/CR,
// lone surrogates, U+FFFE/U+FFFF) make the whole document invalid. Surrogate
// pairs are matched first so that only lone halves are dropped.
const XML_CHARS = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

/** XML-safe text: valid characters only, LF line ends, & < > escaped. */
function xml(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(XML_CHARS, (ch) => (ch.length === 2 ? ch : ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
/** XML-safe value for a double-quoted attribute. */
const xmlAttr = (s: string): string => xml(s).replace(/"/g, "&quot;");
/** One-line XML text (list items and headings cannot hold line breaks). */
const xml1 = (s: string): string => xml(s.replace(/\s*[\r\n]+\s*/g, " ").trim());
/** Multi-line XML text: no leading/trailing blank lines, at most one empty line in a row. */
const xmlBlock = (s: string): string =>
  xml(s.replace(/\r\n?/g, "\n").replace(/^\s*\n|\s+$/g, "").replace(/\n\s*\n(\s*\n)+/g, "\n\n"));

// Notes are a sequence of blocks (headings, lists) and text lines; text lines
// next to each other need a "\n" between them, blocks do not (Asana would show
// an empty paragraph).
type Part = { block: string } | { text: string };
function joinParts(parts: Part[]): string {
  let out = "";
  let prevText = false;
  for (const p of parts) {
    if ("text" in p) {
      if (!p.text) continue;
      out += (prevText ? "\n" : "") + p.text;
      prevText = true;
    } else {
      out += p.block;
      prevText = false;
    }
  }
  return out;
}

/**
 * The memo as Asana rich text for `tasks.html_notes`: the same content as
 * "Copy for Asana", with the decision maker's answers under the questions.
 * `link` adds a line pointing back to the memo in the app (http(s) only).
 */
export function asanaTaskNotes(m: ExportMemo, opts: { link?: { href: string; label: string } } = {}): string {
  const { lang, team } = m;
  const c = contentOf(m);
  const T = doc(lang);
  const u = ui(lang);
  const parts: Part[] = [];
  parts.push({ block: `<h1>${xml1(asanaTaskName(m))}</h1>` });
  // The decision maker answers in the app: the way back comes first.
  const link = opts.link;
  if (link && /^https?:\/\/[^\s]+$/i.test(link.href)) {
    parts.push({ text: `<a href="${xmlAttr(link.href)}">${xml1(link.label || link.href)}</a>` });
  }
  metaFields(lang, team).forEach((f, i) => {
    parts.push({ text: `<strong>${xml1(f.label)}</strong> ${xml1(c.meta[i])}` });
  });
  sectionsFor(lang, team).forEach((s, i) => {
    parts.push({ block: `<h2>${xml1(s.label)} · ${xml1(s.question)}</h2>` });
    if (i < 4) parts.push({ text: xmlBlock(c.s[i]) });
    if (c.kind === "mini") {
      if (i === 3 && c.works.trim()) parts.push({ text: `<strong>${xml1(u.worksIf)} :</strong> ${xmlBlock(c.works)}` });
      return;
    }
    if (i === 3) {
      const acts = filledActs(c);
      if (acts.length) {
        parts.push({ text: `<strong>${xml1(T.actL)}</strong>` });
        const cells = (a: (typeof acts)[number]) => [a.action, a.owner, a.due].map(xml1).filter(Boolean).join(" · ");
        parts.push({ block: `<ol>${acts.map((a) => `<li>${cells(a)}</li>`).join("")}</ol>` });
      }
      const needs = filledNeeds(c);
      if (needs.length) {
        parts.push({ text: `<strong>${xml1(T.needL)}</strong>` });
        parts.push({ block: `<ul>${needs.map((n) => `<li>${box(n.done)} ${xml1(n.text)}</li>`).join("")}</ul>` });
      }
      if (c.res.trim()) parts.push({ text: `<strong>${xml1(u.res)} :</strong> ${xmlBlock(c.res)}` });
    }
    if (i === 4) {
      // Numbered by hand rather than <ol>: an answer can span several lines,
      // and list items cannot hold line breaks.
      filledQs(c).forEach((q, n) => {
        const answer = xmlBlock(answerOf(m, q.id));
        parts.push({ text: `<strong>${n + 1}. ${xml1(q.q)}</strong>` });
        parts.push({ text: answer ? `→ ${answer}` : "→" });
      });
    }
  });
  return `<body>${joinParts(parts)}</body>`;
}
