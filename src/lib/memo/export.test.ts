import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Lang, type Team, teamCover } from "@/lib/content";
import {
  type ExportMemo,
  asanaHTML,
  asanaTaskName,
  asanaTaskNotes,
  exportSheetHTML,
  htmlToText,
  pdfFileName,
} from "./export";
import { type MemoContent, exampleMemo } from "./model";

// Golden outputs recorded from the prototype by scripts/capture-prototype-exports.mjs.
interface GoldenCase {
  name: string;
  input: ExportMemo;
  asanaHTML: string;
  text: string;
  exportSheetHTML: string;
  pdfFileName: string;
}
interface Golden {
  coverPlaceholder: string;
  pdfOptions: unknown;
  cases: GoldenCase[];
}
const golden: Golden = JSON.parse(
  readFileSync(new URL("../../../tests/fixtures/prototype-exports.json", import.meta.url), "utf8"),
);

// The only normalisation: the cover <img> src. The prototype inlined a base64
// data URL (IMGS[pole]); the app points at public/covers/<team>.jpg.
const COVER = /^<div class="pg cover"><img src="[^"]*" alt="">/;
const withCover = (html: string, src: string) => html.replace(COVER, `<div class="pg cover"><img src="${src}" alt="">`);

describe("prototype parity (golden fixtures)", () => {
  it("covers every team and language", () => {
    const seen = new Set(golden.cases.map((c) => `${c.input.team}/${c.input.lang}`));
    expect(seen.size).toBe(12);
    expect(golden.cases.length).toBeGreaterThanOrEqual(40);
  });

  describe.each(golden.cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    it("asanaHTML is identical", () => {
      expect(asanaHTML(c.input)).toBe(c.asanaHTML);
    });
    it("htmlToText is identical to the DOM-based version", () => {
      expect(htmlToText(c.asanaHTML)).toBe(c.text);
    });
    it("exportSheetHTML is identical apart from the cover src", () => {
      const html = exportSheetHTML(c.input);
      expect(html.startsWith(`<div class="pg cover"><img src="${teamCover(c.input.team)}" alt="">`)).toBe(true);
      expect(withCover(html, golden.coverPlaceholder)).toBe(c.exportSheetHTML);
    });
    it("pdfFileName is identical", () => {
      expect(pdfFileName(c.input)).toBe(c.pdfFileName);
    });
  });

  it("model.exampleMemo() is the prototype's exampleState()", () => {
    const stripIds = (x: MemoContent) => JSON.parse(JSON.stringify(x, (k, v) => (k === "id" ? undefined : v)));
    for (const c of golden.cases.filter((x) => x.name.startsWith("example/"))) {
      const ex = exampleMemo(c.input.lang, c.input.team);
      expect(ex.title).toBe(c.input.title);
      expect(stripIds(ex.content)).toEqual(stripIds(c.input.content));
      expect(asanaHTML({ team: c.input.team, lang: c.input.lang, ...ex })).toBe(c.asanaHTML);
    }
  });

  it("uses a custom cover src when given one", () => {
    const c = golden.cases[0];
    expect(exportSheetHTML(c.input, { coverSrc: 'x".jpg' })).toContain('<img src="x&quot;.jpg" alt="">');
  });
});

describe("htmlToText", () => {
  it("decodes entities in one pass", () => {
    expect(htmlToText("<p>&amp;lt;b&amp;gt; &lt;i&gt; &amp;amp;</p>")).toBe("&lt;b&gt; <i> &amp;");
  });
  it("normalises CR/CRLF like the HTML parser, drops NUL and collapses blank lines", () => {
    expect(htmlToText("<p>a\r\nb\rc\0d</p><p></p><p></p><p>e</p>")).toBe("a\nb\ncd\n\ne");
  });
});

describe("pdfFileName", () => {
  const m = (title: string, team: Team = "ops", lang: Lang = "fr"): ExportMemo => ({
    team,
    lang,
    title,
    content: exampleMemo(lang, team).content,
  });
  it("sanitises the title and falls back to the team label", () => {
    expect(pdfFileName(m("Corriger les retours Amazon avant octobre"))).toBe(
      "Memo_Corriger_les_retours_Amazon_avant_octobre.pdf",
    );
    expect(pdfFileName(m("", "mini", "en"))).toBe("Memo_Ad_mini_memo.pdf");
    expect(pdfFileName(m("x".repeat(80))).length).toBe("Memo_".length + 60 + ".pdf".length);
  });
});

describe("asanaTaskName", () => {
  it("prefixes the title like the prototype's guide (« MÉMO : ta décision »)", () => {
    expect(asanaTaskName({ team: "ops", lang: "fr", ...exampleMemo("fr", "ops") })).toBe(
      "MÉMO : Corriger les retours Amazon avant octobre",
    );
    expect(asanaTaskName({ team: "mini", lang: "en", ...exampleMemo("en", "mini") })).toBe(
      "AD: The boxer that doesn’t get holes",
    );
  });
  it("uses the team label when untitled and collapses whitespace", () => {
    const content = exampleMemo("en", "sav").content;
    expect(asanaTaskName({ team: "sav", lang: "en", title: "  ", content })).toBe("MEMO: Support");
    expect(asanaTaskName({ team: "sav", lang: "fr", title: " Deux\n lignes ", content })).toBe("MÉMO : Deux lignes");
  });
});

// ---------- Asana rich text ----------

// Tags Asana accepts in html_notes (see the comment in export.ts), and what we allow on them.
const ALLOWED = new Set(["body", "h1", "h2", "strong", "em", "u", "s", "code", "pre", "ol", "ul", "li", "a", "blockquote", "hr"]);
const ATTRS: Record<string, string[]> = { a: ["href"] };

interface El {
  name: string;
  parents: string[];
  attrs: Record<string, string>;
}

const ENTITY = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/y;
const XML_CHAR = /^(?:[\t\n\r\x20-\uD7FF\uE000-\uFFFD]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;
const decodeXml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, (_, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e],
  );

/** Checks character data: no markup characters, only well-formed references, only XML chars. */
function checkChars(s: string, where: string): void {
  if (!XML_CHAR.test(s)) throw new Error(`invalid XML character in ${where}`);
  if (/[<>]/.test(s)) throw new Error(`raw < or > in ${where}`);
  for (let i = s.indexOf("&"); i !== -1; i = s.indexOf("&", i + 1)) {
    ENTITY.lastIndex = i;
    if (!ENTITY.test(s)) throw new Error(`bare & in ${where}: ${s.slice(i, i + 12)}`);
  }
}

/**
 * A tiny, strict XML well-formedness check (no DOMParser in Node): one root,
 * balanced tags, quoted unique attributes, escaped text, valid characters.
 * Stricter than XML where it costs nothing (no comments, PIs, CDATA or `>` in text).
 */
function parseXml(xml: string): { elements: El[]; text: string } {
  const elements: El[] = [];
  const stack: string[] = [];
  let text = "";
  let roots = 0;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const chunk = lt === -1 ? xml.slice(i) : xml.slice(i, lt);
    checkChars(chunk, "text");
    if (chunk && stack.length === 0) throw new Error("text outside the root element");
    text += decodeXml(chunk);
    if (lt === -1) break;
    const gt = xml.indexOf(">", lt);
    if (gt === -1) throw new Error("unterminated tag");
    const tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1);
      if (stack.pop() !== name) throw new Error(`mismatched </${name}>`);
      continue;
    }
    const self = tag.endsWith("/");
    const m = /^([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.-]*="[^"]*")*)\s*$/.exec(self ? tag.slice(0, -1) : tag);
    if (!m) throw new Error(`malformed tag <${tag}>`);
    const attrs: Record<string, string> = {};
    for (const [, k, v] of m[2].matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) {
      if (k in attrs) throw new Error(`duplicate attribute ${k}`);
      checkChars(v, `attribute ${k}`);
      attrs[k] = decodeXml(v);
    }
    if (stack.length === 0 && ++roots > 1) throw new Error("more than one root element");
    elements.push({ name: m[1], parents: [...stack], attrs });
    if (!self) stack.push(m[1]);
  }
  if (stack.length) throw new Error(`unclosed <${stack.pop()}>`);
  if (roots !== 1) throw new Error("no root element");
  return { elements, text };
}

/** Asana's structural rules on top of well-formedness. */
function checkAsanaRules(notes: string): { elements: El[]; text: string } {
  const doc = parseXml(notes);
  expect(doc.elements[0].name).toBe("body");
  for (const el of doc.elements) {
    expect(ALLOWED.has(el.name), `<${el.name}> is not allowed`).toBe(true);
    for (const k of Object.keys(el.attrs)) expect(ATTRS[el.name] ?? [], `${k} on <${el.name}>`).toContain(k);
    const parent = el.parents[el.parents.length - 1];
    if (el.name === "li") expect(["ol", "ul"]).toContain(parent);
    if (["h1", "h2", "blockquote", "pre", "ol", "ul"].includes(el.name)) {
      // Blocks sit directly in <body>: never in list items, headings, quotes or code.
      expect(parent, `<${el.name}> inside <${parent}>`).toBe("body");
    }
  }
  return doc;
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** Every user string the notes show (like the copy, they leave out the author field). */
function userStrings(m: ExportMemo): string[] {
  const c = m.content;
  const out = [m.title, ...c.meta, ...c.s];
  if (c.kind === "mini") return [...out, c.works];
  return [
    ...out,
    ...c.acts.flatMap((a) => [a.action, a.owner, a.due]),
    ...c.needs.map((n) => n.text),
    c.res,
    ...c.qs.map((q) => q.q),
    ...Object.values(m.answers ?? {}),
  ];
}

describe("asanaTaskNotes", () => {
  it("(the XML check itself rejects malformed documents)", () => {
    for (const bad of [
      "<body>a & b</body>",
      "<body>a &nbsp; b</body>",
      "<body><h1>x</body>",
      "<body>x</body><body></body>",
      "text<body></body>",
      '<body><a href=x>y</a></body>',
      '<body><a href="x" href="y">y</a></body>',
      "<body>a > b</body>",
      "<body>\u0001</body>",
      "<body>\uD800</body>",
    ])
      expect(() => parseXml(bad), bad).toThrow();
    expect(parseXml('<body>a &amp; <a href="?a=1&amp;b">x</a><hr/></body>').text).toBe("a & x");
  });

  it("is well-formed and uses only Asana's tags for every golden case", () => {
    for (const c of golden.cases) {
      const notes = asanaTaskNotes(c.input);
      expect(notes.startsWith("<body>") && notes.endsWith("</body>")).toBe(true);
      expect(() => checkAsanaRules(notes), c.name).not.toThrow();
      expect(notes).not.toMatch(/<(p|br|b|i|div|span)\b/);
    }
  });

  it("contains the answers under their questions", () => {
    for (const c of golden.cases.filter((x) => x.input.answers)) {
      const { text } = checkAsanaRules(asanaTaskNotes(c.input));
      if (c.input.content.kind !== "memo") continue;
      for (const q of c.input.content.qs) {
        const answer = c.input.answers?.[q.id];
        if (!q.q.trim() || !answer?.trim()) continue;
        const lines = answer.replace(/\r\n?/g, "\n").replace(/\0/g, "").trim().split("\n").filter(Boolean);
        const at = text.indexOf(oneLine(q.q.replace(/\0/g, "")));
        expect(at, `${c.name}: question ${q.id}`).toBeGreaterThan(-1);
        for (const line of lines) expect(text.indexOf(line, at), `${c.name}: answer ${q.id}`).toBeGreaterThan(at);
      }
      // Answers to empty questions are not exported (same filter as the copy).
      expect(text).not.toContain("orphan answer");
    }
  });

  it("keeps every piece of user text, and user text cannot add tags", () => {
    const evil = `<b>x</b> & "q" 'a' <body></body> </li><li> <a href="javascript:alert(1)">y</a> ]]> <!-- c --> \u0001\uFFFF\uD800 🚀`;
    for (const team of ["ops", "mini"] as const) {
      const base = exampleMemo("en", team);
      const fill = (s: string) => (s === "" ? "" : evil);
      const deep = <T,>(x: T, f: (s: string) => string): T =>
        JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "string" && k !== "id" && k !== "kind" ? f(v) : v)));
      const ids = base.content.kind === "memo" ? base.content.qs.map((q) => q.id) : [];
      const answers = Object.fromEntries(ids.map((id) => [id, "answer"]));
      const bad: ExportMemo = { team, lang: "en", title: evil, content: deep(base.content, fill), answers: deep(answers, fill) };
      const good: ExportMemo = { team, lang: "en", title: "x", content: deep(base.content, (s) => (s ? "x" : "")), answers };

      const badDoc = checkAsanaRules(asanaTaskNotes(bad));
      const goodDoc = checkAsanaRules(asanaTaskNotes(good));
      // Same element skeleton: the payload only ever became text.
      expect(badDoc.elements.map((e) => `${e.parents.join(">")}>${e.name}`)).toEqual(
        goodDoc.elements.map((e) => `${e.parents.join(">")}>${e.name}`),
      );
      // …and all of it is still there, minus the characters XML cannot carry.
      const visible = oneLine(evil.replace(/[\u0001\uFFFF\uD800]/g, ""));
      const shown = userStrings(bad).filter(Boolean);
      expect(shown.length).toBeGreaterThanOrEqual(10);
      for (const s of shown) expect(s).toBe(evil);
      expect(badDoc.text.split(visible).length - 1).toBe(shown.length);
    }
  });

  it("writes the memo as Asana rich text", () => {
    const m: ExportMemo = {
      team: "ops",
      lang: "en",
      title: "Fix returns",
      content: {
        kind: "memo",
        author: "Khalifa",
        meta: ["Mattéo", "Khalifa", "29 September 2026", "Fix returns"],
        s: ["Returns are at 31%.\nSince July.", "", "Steps:\n1) Relabel", "I propose we relabel.\n\n"],
        acts: [
          { id: "a1", action: "Relabel", owner: "Khalifa", due: "2 October" },
          { id: "a2", action: "", owner: "", due: "" },
        ],
        needs: [
          { id: "n1", done: true, text: "Your go" },
          { id: "n2", done: false, text: "Budget" },
        ],
        res: "Under 5% by November",
        qs: [
          { id: "q1", q: "Do we relabel?" },
          { id: "q2", q: "Budget?" },
        ],
      },
      answers: { q1: "Yes.\nStart Monday." },
    };
    expect(asanaTaskNotes(m, { link: { href: "https://memo.boxhero.test/memos/1?a=1&b=2", label: "Open the memo" } })).toBe(
      "<body><h1>MEMO: Fix returns</h1>" +
        '<a href="https://memo.boxhero.test/memos/1?a=1&amp;b=2">Open the memo</a>\n' +
        "<strong>TO</strong> Mattéo\n<strong>FROM</strong> Khalifa\n<strong>DATE</strong> 29 September 2026\n<strong>RE</strong> Fix returns" +
        "<h2>WHY · Why now?</h2>Returns are at 31%.\nSince July." +
        "<h2>WHAT · The problem</h2>" +
        "<h2>HOW · How we fix it</h2>Steps:\n1) Relabel" +
        "<h2>NOW · What I propose</h2>I propose we relabel.\n<strong>Actions</strong>" +
        "<ol><li>Relabel · Khalifa · 2 October</li></ol><strong>What I need</strong>" +
        "<ul><li>☒ Your go</li><li>☐ Budget</li></ul><strong>Expected result :</strong> Under 5% by November" +
        "<h2>QUESTIONS · To decide</h2>" +
        "<strong>1. Do we relabel?</strong>\n→ Yes.\nStart Monday.\n<strong>2. Budget?</strong>\n→</body>",
    );
  });

  it("drops empty action cells and runs of blank lines", () => {
    const base = exampleMemo("fr", "ops");
    if (base.content.kind !== "memo") throw new Error("expected a full memo");
    const m: ExportMemo = {
      team: "ops",
      lang: "fr",
      title: base.title,
      content: {
        ...base.content,
        s: ["a\r\n\r\n\r\n\r\nb", "\n\n  c  \n\n", "", ""],
        acts: [{ id: "a1", action: "", owner: "Khalifa", due: "" }],
      },
      answers: { [base.content.qs[0].id]: "oui\n\n\n\nnon" },
    };
    const notes = asanaTaskNotes(m);
    expect(notes).toContain("</h2>a\n\nb<h2>");
    expect(notes).toContain("</h2>  c<h2>");
    expect(notes).toContain("<ol><li>Khalifa</li></ol>");
    expect(notes).toContain("→ oui\n\nnon</body>");
  });

  it("ignores links that are not http(s)", () => {
    const m: ExportMemo = { team: "mini", lang: "fr", ...exampleMemo("fr", "mini") };
    expect(asanaTaskNotes(m, { link: { href: "javascript:alert(1)", label: "x" } })).not.toContain("<a ");
    expect(asanaTaskNotes(m, { link: { href: "https://a.test/x y", label: "x" } })).not.toContain("<a ");
  });
});
