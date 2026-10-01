"use client";
// The memo sheet, ported from the prototype's render(), renderActs(),
// renderNeeds() and renderQs(): same elements, classes, ids, data-attributes,
// inline styles and placeholders. Read-only viewers get the same sheet with
// readOnly inputs, disabled checkboxes and no add/remove buttons.
import { type Lang, type Team, content as appContent, doc, esc, md, memoSections, metaFields, miniSections, placeholders, ui } from "@/lib/content";
import * as E from "@/lib/memo/editor/edit";
import type { MemoContent } from "@/lib/memo/model";
import { GrowArea } from "./GrowArea";

export interface MemoSheetProps {
  /** UI language: labels, examples and placeholders. */
  lang: Lang;
  team: Team;
  title: string;
  content: MemoContent;
  /** Decision maker's answers by question id. */
  answers: Record<string, string>;
  editable: boolean;
  answerable: boolean;
  answerPlaceholder: string;
  onTitle: (v: string) => void;
  onContent: (f: (c: MemoContent) => MemoContent) => void;
  onAnswer: (questionId: string, v: string) => void;
}

/** "Ex. : <the team's example title>": the prefix comes from ui.titlePh, which ends with the Operations title. */
function titlePlaceholder(lang: Lang, team: Team): string {
  const u = ui(lang);
  if (team === "mini") return u.miniTitlePh;
  const titles = appContent.examples.titles[lang];
  const prefix = u.titlePh.endsWith(titles.ops) ? u.titlePh.slice(0, -titles.ops.length) : "";
  return prefix + titles[team];
}

/** The example box: label + example with **bold** and [italic hints]. Content comes from our JSON only. */
const exHtml = (lang: Lang, example: string) => `<span class="lab">${esc(doc(lang).ex)}</span>${md(example)}`;

export function MemoSheet(p: MemoSheetProps) {
  const { lang, team, content: c, editable } = p;
  const u = ui(lang);
  const T = doc(lang);
  const ph = placeholders(lang, team);
  const ro = !editable;
  const edit = p.onContent;
  const val = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => f(e.target.value);

  const head = (
    <>
      <div className="titlefield" style={{ marginTop: 4 }}>
        <label htmlFor="fTitle">{team === "mini" ? u.miniTitleL : u.titleL}</label>
        <input
          id="fTitle"
          data-f="title"
          placeholder={titlePlaceholder(lang, team)}
          value={p.title}
          readOnly={ro}
          onChange={val(p.onTitle)}
        />
      </div>
      <div className="meta">
        {metaFields(lang, team).map((f, i) => (
          <div key={i} className={i === 3 && team !== "mini" ? "full" : ""}>
            <label htmlFor={`fMeta${i}`}>{f.label}</label>
            <input
              id={`fMeta${i}`}
              data-m={i}
              placeholder={f.placeholder}
              value={c.meta[i]}
              readOnly={ro}
              onChange={val((v) => edit((x) => E.setMeta(x, i, v)))}
            />
          </div>
        ))}
        <div>
          <label htmlFor="fAuthor">{u.author}</label>
          <input
            id="fAuthor"
            data-f="author"
            placeholder={u.author}
            value={c.author}
            readOnly={ro}
            onChange={val((v) => edit((x) => E.setAuthor(x, v)))}
          />
        </div>
      </div>
    </>
  );

  const field = (i: number, placeholder: string, label: string, style?: React.CSSProperties) => (
    <GrowArea
      className="field"
      data-s={i}
      style={style}
      placeholder={placeholder}
      aria-label={label}
      value={c.s[i]}
      readOnly={ro}
      onChange={val((v) => edit((x) => E.setSection(x, i, v)))}
    />
  );

  if (c.kind === "mini") {
    return (
      <main className={ro ? "sheet ro" : "sheet"} id="sheet">
        {head}
        {miniSections(lang).map((s, i) => (
          <section className="sec" id={`s${i}`} key={i}>
            <h2>{s.label}</h2>
            <p className="q">{s.question}</p>
            <div className="ex" dangerouslySetInnerHTML={{ __html: exHtml(lang, s.example) }} />
            {field(i, ph[i], s.question)}
            {i === 3 && (
              <>
                <div className="sub">{u.worksIf}</div>
                <GrowArea
                  className="field"
                  data-f="works"
                  style={{ minHeight: 60 }}
                  placeholder={u.worksPh}
                  aria-label={u.worksIf}
                  value={c.works}
                  readOnly={ro}
                  onChange={val((v) => edit((x) => E.setWorks(x, v)))}
                />
              </>
            )}
          </section>
        ))}
      </main>
    );
  }

  const examples = T.poles[team as Exclude<Team, "mini">].ex;
  return (
    <main className={ro ? "sheet ro" : "sheet"} id="sheet">
      {head}
      {memoSections(lang).map((s, i) => (
        <section className="sec" id={`s${i}`} key={i}>
          <h2>{s.label}</h2>
          <p className="q">{s.question}</p>
          <div className="ex" dangerouslySetInnerHTML={{ __html: exHtml(lang, examples[i]) }} />
          {i < 3 && field(i, ph[i] || T.fill + "…", s.question)}
          {i === 3 && (
            <>
              <div className="sub">{u.nowProp}</div>
              {field(3, ph[3], u.nowProp, { minHeight: 70 })}
              <div className="sub">{T.actL}</div>
              <div id="acts">
                {c.acts.map((a, j) => (
                  <div className="row" key={a.id}>
                    <input
                      data-a={`${j}:0`}
                      value={a.action}
                      placeholder={u.actPh}
                      aria-label={u.actPh}
                      readOnly={ro}
                      onChange={val((v) => edit((x) => E.setAct(x, a.id, "action", v)))}
                    />
                    <input
                      data-a={`${j}:1`}
                      value={a.owner}
                      placeholder={u.ownPh}
                      aria-label={u.ownPh}
                      readOnly={ro}
                      onChange={val((v) => edit((x) => E.setAct(x, a.id, "owner", v)))}
                    />
                    <input
                      data-a={`${j}:2`}
                      value={a.due}
                      placeholder={u.datePh}
                      aria-label={u.datePh}
                      readOnly={ro}
                      onChange={val((v) => edit((x) => E.setAct(x, a.id, "due", v)))}
                    />
                    {editable && (
                      <button
                        type="button"
                        className="del"
                        data-da={j}
                        aria-label={u.del}
                        onClick={() => edit((x) => E.removeAct(x, a.id))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {editable && (
                <button type="button" className="add" id="addAct" onClick={() => edit(E.addAct)}>
                  + {u.addAct}
                </button>
              )}
              <div className="sub">{T.needL}</div>
              <div id="needs">
                {c.needs.map((n, j) => (
                  <div className="need" key={n.id}>
                    <input
                      type="checkbox"
                      data-nc={j}
                      checked={n.done}
                      disabled={ro}
                      aria-label={u.needPh}
                      onChange={(e) => {
                        const done = e.target.checked;
                        edit((x) => E.setNeedDone(x, n.id, done));
                      }}
                    />
                    <input
                      type="text"
                      data-nt={j}
                      value={n.text}
                      placeholder={u.needPh}
                      aria-label={u.needPh}
                      readOnly={ro}
                      onChange={val((v) => edit((x) => E.setNeedText(x, n.id, v)))}
                    />
                    {editable && (
                      <button
                        type="button"
                        className="del"
                        data-dn={j}
                        aria-label={u.del}
                        onClick={() => edit((x) => E.removeNeed(x, n.id))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {editable && (
                <button type="button" className="add" id="addNeed" onClick={() => edit(E.addNeed)}>
                  + {u.addNeed}
                </button>
              )}
              <div className="sub">{u.res}</div>
              <GrowArea
                className="field"
                data-f="res"
                style={{ minHeight: 56 }}
                placeholder={u.resPh}
                aria-label={u.res}
                value={c.res}
                readOnly={ro}
                onChange={val((v) => edit((x) => E.setRes(x, v)))}
              />
            </>
          )}
          {i === 4 && (
            <>
              <div id="qs">
                {c.qs.map((q, j) => (
                  <div className="qrow" key={q.id}>
                    <input
                      data-q={`${j}:0`}
                      value={q.q}
                      placeholder={u.qPh}
                      aria-label={u.qPh}
                      readOnly={ro}
                      onChange={val((v) => edit((x) => E.setQuestion(x, q.id, v)))}
                    />
                    <GrowArea
                      className="qa"
                      data-q={`${j}:1`}
                      data-qid={q.id}
                      placeholder={p.answerPlaceholder}
                      aria-label={u.aPh}
                      value={p.answers[q.id] ?? ""}
                      readOnly={!p.answerable}
                      onChange={val((v) => p.onAnswer(q.id, v))}
                    />
                    {editable && (
                      <button
                        type="button"
                        className="del"
                        data-dq={j}
                        aria-label={u.del}
                        onClick={() => edit((x) => E.removeQuestion(x, q.id))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {editable && (
                <button type="button" className="add" id="addQ" onClick={() => edit(E.addQuestion)}>
                  + {u.addQ}
                </button>
              )}
            </>
          )}
        </section>
      ))}
    </main>
  );
}
