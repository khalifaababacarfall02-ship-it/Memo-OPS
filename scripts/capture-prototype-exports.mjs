#!/usr/bin/env node
// Records the prototype's exports as golden fixtures for src/lib/memo/export.test.ts.
//
//   node scripts/capture-prototype-exports.mjs <boxhero-memo.html> [out.json]
//
// Loads the single-file prototype in headless Chromium and, for every case
// below, sets its globals (lang, pole, state) and runs the real handlers:
// "Copy for Asana" (clipboard stubbed) and "Download PDF" (html2pdf and the
// host `downloads` API stubbed; the string assigned to #exp.innerHTML is
// captured). Each case is saved with the equivalent app-side ExportMemo.
// Works with the original file or a copy whose base64 IMGS were stripped:
// the cover <img> src is replaced by COVER_PLACEHOLDER either way.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const COVER_PLACEHOLDER = "__COVER__";
const protoPath = process.argv[2] ?? process.env.PROTO_HTML;
if (!protoPath) {
  console.error("usage: node scripts/capture-prototype-exports.mjs <boxhero-memo.html> [out.json]");
  process.exit(2);
}
const outPath = resolve(
  process.argv[3] ?? fileURLToPath(new URL("../tests/fixtures/prototype-exports.json", import.meta.url)),
);

// Injected as a classic script after load, so it can read and assign the
// prototype's top-level `let` bindings (lang, pole, state, downloads).
const HARNESS = String.raw`
window.__cap = (() => {
  const exp = document.querySelector("#exp");
  const inner = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  let expRaw = null, clip = null, saved = null, pdfOptions = null, pdfFrom = null;
  Object.defineProperty(exp, "innerHTML", {
    configurable: true,
    get() { return inner.get.call(this); },
    set(v) { expRaw = v; inner.set.call(this, v); },
  });
  window.ClipboardItem = class { constructor(items) { this.items = items; } };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: async (items) => { clip = items[0].items; }, writeText: async () => { throw new Error("unexpected"); } },
  });
  const chain = {
    set(o) { pdfOptions = o; return chain; },
    from(el) { pdfFrom = el; return chain; },
    outputPdf: async () => new Blob(["%PDF-stub"], { type: "application/pdf" }),
  };
  window.html2pdf = () => chain;
  window.print = () => {};
  downloads = { save: async ({ filename }) => { saved = filename; } };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  return {
    example(l, p) { lang = l; pole = p; return copy(exampleState()); },
    blank(l, p) { lang = l; pole = p; return copy(blank()); },
    async run(l, p, st) {
      lang = l; pole = p; state = copy(st);
      expRaw = clip = saved = pdfOptions = pdfFrom = null;
      const html = asanaHTML();
      const text = htmlToText(html);
      await document.querySelector("#bCopy").onclick();
      if (!clip) throw new Error("copy handler did not write to the clipboard");
      if ((await clip["text/html"].text()) !== html) throw new Error("clipboard html differs from asanaHTML()");
      if ((await clip["text/plain"].text()) !== text) throw new Error("clipboard text differs from htmlToText()");
      await document.querySelector("#bPdf").onclick();
      if (pdfFrom !== exp) throw new Error("html2pdf was not given #exp");
      if (expRaw === null || saved === null) throw new Error("PDF handler did not run to the end");
      return { html, text, exp: expRaw, filename: saved, pdfOptions };
    },
  };
})();
`;

// ---------- cases ----------

const TEAMS = ["ops", "growth", "crea", "sav", "finance", "mini"];
const LANGS = ["fr", "en"];
const NASTY =
  `<script>alert("x")</script> & "double" 'single' **bold** [bracket] 🚀 émoji\n` +
  `line 2 &amp; &lt;b&gt; </p><br> &#169; ` + "\u00a0nbsp\ttab\r\nCRLF\rCR end";

/** Each case: [name, lang, team, (page) => prototype state]. */
function cases() {
  const list = [];
  const add = (name, lang, team, make) => list.push({ name, lang, team, make });
  for (const team of TEAMS)
    for (const lang of LANGS) add(`example/${team}/${lang}`, lang, team, (cap) => cap.example(lang, team));
  for (const team of TEAMS)
    for (const lang of LANGS) add(`blank/${team}/${lang}`, lang, team, (cap) => cap.blank(lang, team));

  // The decision maker's answers (the prototype kept them in qs[i][1]).
  const answered = [["ops", "fr"], ["growth", "en"], ["crea", "fr"], ["sav", "en"], ["finance", "fr"]];
  for (const [team, lang] of answered)
    add(`answers/${team}/${lang}`, lang, team, async (cap) => {
      const st = await cap.example(lang, team);
      st.qs = [
        [st.qs[0][0], lang === "fr" ? "Oui, go.\nOn refait le point le 15." : "Yes, go.\nLet's review on the 15th."],
        [lang === "fr" ? "Budget maximum ?" : "Maximum budget?", ""],
        ["", "orphan answer to an empty question"],
        ["  ", "whitespace-only question"],
        [lang === "fr" ? "Qui valide ?" : "Who signs off?", `Khalifa — **ok** <ok> & "merci"\n\n\n\nafter blank lines`],
      ];
      return st;
    });

  // Special characters in every field.
  for (const [team, lang] of [["ops", "fr"], ["sav", "en"], ["mini", "fr"], ["mini", "en"]])
    add(`special/${team}/${lang}`, lang, team, async (cap) => {
      const st = await cap.blank(lang, team);
      st.title = `Title <b>&</b> "quoted" 'single' **stars** 🚀 [x]`;
      st.author = `Aut<h>or & "co"`;
      st.meta = st.meta.map((_, i) => `meta ${i} <i>&amp;</i> "q"\nnext`);
      st.s = st.s.map((_, i) => `${i}: ${NASTY}`);
      if (team === "mini") st.works = `works ${NASTY}`;
      else {
        st.acts = [[`act <1> & "a"`, `own'er`, `due\n2`], ["**x**", "", ""]];
        st.needs = [[true, `need <&> "n"`], [false, "🚀 emoji need"]];
        st.res = `res ${NASTY}`;
        st.qs = [[`q <1> & "q"`, `ans ${NASTY}`], ["q2 \0nul", "a2 \0nul"]];
      }
      return st;
    });

  // Empty or partial rows, whitespace-only fields (the prototype's filters).
  for (const [team, lang] of [["ops", "fr"], ["finance", "en"]])
    add(`rows/${team}/${lang}`, lang, team, async (cap) => {
      const st = await cap.blank(lang, team);
      st.title = "Rows";
      st.s = ["   ", "\n\n", "", "Only now"];
      st.acts = [["", "", ""], ["  ", " ", "\t"], ["", "Khalifa", ""], ["Do it", "", ""], ["", "", "Friday"]];
      st.needs = [[true, ""], [false, "   "], [true, "Checked"], [false, "Unchecked"], [true, " padded "]];
      st.res = "   ";
      st.qs = [["", ""], ["   ", "orphan"], ["Question only", ""], ["\tTabbed question ", " answer "]];
      return st;
    });

  // Checked requests.
  for (const [team, lang] of [["growth", "fr"], ["crea", "en"]])
    add(`checked/${team}/${lang}`, lang, team, async (cap) => {
      const st = await cap.example(lang, team);
      st.needs = [[true, st.needs[0][1]], [false, "Budget"], [true, "Asana"]];
      st.res = lang === "fr" ? "+12 % de marge au 31 octobre" : "+12% margin by 31 October";
      return st;
    });

  // Titles and PDF file names.
  const titles = [
    ["crea", "fr", "Un titre beaucoup trop long pour tenir dans le nom du fichier PDF sans être coupé net"],
    ["ops", "en", "!!! ???"],
    ["sav", "fr", "   "],
    ["mini", "fr", "Été 2026 : 🚀 lancement « Nova » 2.0 — l’offre"],
  ];
  titles.forEach(([team, lang, title], i) =>
    add(`title/${i + 1}/${team}/${lang}`, lang, team, async (cap) => ({ ...(await cap.example(lang, team)), title })),
  );

  // "It works if" is shown when it is truthy (even whitespace), hidden when empty.
  add("works/space/mini/en", "en", "mini", async (cap) => ({ ...(await cap.example("en", "mini")), works: " " }));
  add("works/empty/mini/fr", "fr", "mini", async (cap) => ({ ...(await cap.example("fr", "mini")), works: "" }));
  add("works/lines/mini/fr", "fr", "mini", async (cap) => ({
    ...(await cap.example("fr", "mini")),
    works: "CPA < 35 $\npanier > 70 $",
  }));
  return list;
}

/** The app-side input for a prototype state (answers move to memo_answers). */
function toExportMemo(lang, team, st) {
  if (team === "mini")
    return { team, lang, title: st.title, content: { kind: "mini", author: st.author, meta: st.meta, s: st.s, works: st.works } };
  const answers = {};
  st.qs.forEach((q, i) => {
    if (q[1] !== "") answers[`q${i + 1}`] = q[1];
  });
  const memo = {
    team,
    lang,
    title: st.title,
    content: {
      kind: "memo",
      author: st.author,
      meta: st.meta,
      s: st.s,
      acts: st.acts.map((a, i) => ({ id: `a${i + 1}`, action: a[0], owner: a[1], due: a[2] })),
      needs: st.needs.map((n, i) => ({ id: `n${i + 1}`, done: n[0], text: n[1] })),
      res: st.res,
      qs: st.qs.map((q, i) => ({ id: `q${i + 1}`, q: q[0] })),
    },
  };
  return Object.keys(answers).length ? { ...memo, answers } : memo;
}

const coverRe = /^<div class="pg cover"><img src="[^"]*" alt="">/;

async function main() {
  const source = readFileSync(protoPath);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Offline: fonts and the html2pdf CDN script are not needed (html2pdf is stubbed).
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(resolve(protoPath)).href);
    await page.addScriptTag({ content: HARNESS });
    const cap = {
      example: (l, p) => page.evaluate(([l, p]) => window.__cap.example(l, p), [l, p]),
      blank: (l, p) => page.evaluate(([l, p]) => window.__cap.blank(l, p), [l, p]),
    };
    let pdfOptions = null;
    const out = [];
    for (const c of cases()) {
      const st = await c.make(cap);
      const r = await page.evaluate(([l, p, s]) => window.__cap.run(l, p, s), [c.lang, c.team, st]);
      if (!coverRe.test(r.exp)) throw new Error(`${c.name}: unexpected #exp start`);
      const optionsJson = JSON.stringify(r.pdfOptions);
      if (pdfOptions !== null && optionsJson !== JSON.stringify(pdfOptions)) throw new Error("PDF options vary");
      pdfOptions = r.pdfOptions;
      out.push({
        name: c.name,
        input: toExportMemo(c.lang, c.team, st),
        asanaHTML: r.html,
        text: r.text,
        exportSheetHTML: r.exp.replace(coverRe, `<div class="pg cover"><img src="${COVER_PLACEHOLDER}" alt="">`),
        pdfFileName: r.filename,
      });
    }
    const fixture = {
      _readme:
        "Golden outputs of the prototype's exports. Generated by scripts/capture-prototype-exports.mjs; do not edit by hand.",
      prototype: { file: basename(protoPath), sha256: createHash("sha256").update(source).digest("hex") },
      coverPlaceholder: COVER_PLACEHOLDER,
      pdfOptions,
      cases: out,
    };
    writeFileSync(outPath, JSON.stringify(fixture, null, 1) + "\n");
    console.log(`${out.length} cases → ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
