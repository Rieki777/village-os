/**
 * THE PRINTABLE CANVAS WORKBOOK: the sheet itself (2026-09-25).
 *
 * What a group needs on the table to talk the Governance Canvas through
 * before its village has an instance, or beside one: the four foundations,
 * the twelve blocks (the canvas's question and description, our own
 * questions, room to write, the five levels to circle, a line for the
 * reason), a blank Decision Matrix, the four key moments, and the credit.
 *
 * It knows ONE thing about the village, its name, and it is handed that. It
 * fetches nothing, so it reads the same to a visitor who has never signed in,
 * which is the point: a Season Two project can print it on the first Saturday.
 *
 * ── THE CIRCLED LEVEL IS NOT A SCORE ───────────────────────────────────────
 *
 * Each block carries its own row of five levels, and the reader circles one
 * by hand. The sheet never adds circled levels up, never counts blocks, and
 * never says how far through the canvas a village is, the same line the
 * Canvas view holds under R55. client/src/lib/canvasCopy.test.ts sweeps this
 * file with the view's rules, and CanvasWorkbook.test.tsx reads the rendered
 * page for any digit that is not a block's number or a level's numeral.
 *
 * ── PRINT ──────────────────────────────────────────────────────────────────
 *
 * The page (client/src/pages/CanvasWorkbook.tsx) owns the print stylesheet
 * and the paper size. This file only marks its parts: `wb-keep` for what
 * must not split across a page, `wb-break` for what starts a new page, and
 * `wb-card` for the screen-only card chrome that print takes off. One block
 * per printed page, so the writing space is real on A4 and on US Letter.
 */
import type { ReactNode } from "react";
import { CANVAS_FOUNDATIONS, CANVAS_LEVELS, CANVAS_ORDER, type CanvasBlock } from "@shared/governanceCanvas";
import {
  CANVAS_BLOCK_TEXT,
  CANVAS_CREDIT,
  CANVAS_DECISION_MATRIX_COLUMNS,
  CANVAS_FOUNDATION_TEXT,
  CANVAS_KEY_MOMENTS,
  CANVAS_SCALE_TEXT,
} from "@shared/governanceCanvasText";
import {
  MATRIX_BLANK_ROWS,
  WORKBOOK_AFTER,
  WORKBOOK_LEVELS_NOTE,
  WORKBOOK_MATRIX_NOTE,
  WORKBOOK_MOMENTS_NOTE,
  blockHeading,
  workbookHowTo,
} from "@/lib/canvasWorkbook";

/** The credit, linked, in the words every canvas surface uses. */
function Credit({ testId }: { testId: string }) {
  return (
    <p className="text-sm text-stone-700" data-testid={testId}>
      Quoted from the{" "}
      <a href={CANVAS_CREDIT.url} target="_blank" rel="noreferrer" className="font-medium text-stone-900 underline">
        {CANVAS_CREDIT.text}
      </a>
      . The canvas lives at <span className="break-all">{CANVAS_CREDIT.url}</span>
    </p>
  );
}

/** Ruled lines to write on. Presentational: the label above says what they are for. */
function Lines({ count }: { count: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-8 border-b border-stone-300" />
      ))}
    </div>
  );
}

/** A labelled line for a name or a date on the cover. */
function Blank({ label }: { label: string }) {
  return (
    <div className="flex items-end gap-2 text-sm">
      <span className="shrink-0 font-medium text-stone-800">{label}</span>
      <span aria-hidden="true" className="h-6 flex-1 border-b border-stone-400" />
    </div>
  );
}

/** The five levels in a row, to circle one. The numeral sits beside its word and never on its own. */
function CircleOne({ blockName }: { blockName: string }) {
  return (
    <ol className="mt-2 flex flex-wrap gap-2" aria-label={`Levels for ${blockName}, circle one`}>
      {CANVAS_LEVELS.map((level) => (
        <li key={level} className="rounded-full border border-stone-400 px-3 py-1 text-sm text-stone-900">
          <span className="font-semibold">{level}</span> {CANVAS_SCALE_TEXT[level].word}
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`wb-card bg-white border border-stone-200 rounded-xl p-5 sm:p-6 space-y-3 ${className}`}>
      <h2 className="font-display text-xl font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}

function BlockPage({ block }: { block: CanvasBlock }) {
  const canvas = CANVAS_BLOCK_TEXT[block.id];
  return (
    <section
      className="wb-card wb-keep wb-break bg-white border border-stone-200 rounded-xl p-5 sm:p-6 space-y-4"
      data-testid={`workbook-block-${block.id}`}
      aria-labelledby={`workbook-block-${block.id}-title`}
    >
      <header>
        <h3 id={`workbook-block-${block.id}-title`} className="font-display text-lg font-semibold text-stone-900">
          {blockHeading(block)}
        </h3>
        <p className="text-xs text-stone-600">{block.foundations.map((f) => CANVAS_FOUNDATION_TEXT[f].name).join(" · ")}</p>
      </header>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-stone-600">The canvas asks</p>
        <blockquote cite={CANVAS_CREDIT.url} className="mt-1 space-y-1.5">
          <p className="font-medium text-stone-900">{canvas.question}</p>
          <p className="text-sm text-stone-700">{canvas.description}</p>
        </blockquote>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-stone-600">Our questions to talk through</p>
        <p className="mt-1 text-sm text-stone-900">{block.question}</p>
        <ul className="mt-1.5 list-disc pl-5 space-y-1 text-sm text-stone-700">
          {block.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-sm font-medium text-stone-800">What we say</p>
        <Lines count={7} />
      </div>

      <div>
        <p className="text-sm font-medium text-stone-800">Where it stands today (circle one)</p>
        <CircleOne blockName={block.name} />
      </div>

      <div>
        <p className="text-sm font-medium text-stone-800">Why, in one sentence</p>
        <Lines count={2} />
      </div>
    </section>
  );
}

export function CanvasWorkbookSheet({ villageName }: { villageName: string }) {
  return (
    <article className="canvas-workbook-sheet space-y-6 text-stone-900" data-testid="canvas-workbook">
      <header className="wb-card wb-keep bg-white border border-stone-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-600">Governance Canvas workbook</p>
          <h1 className="font-display text-3xl font-bold text-stone-900" data-testid="workbook-village">
            {villageName}
          </h1>
        </div>
        <Credit testId="workbook-credit-top" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Blank label="Filled in by" />
          <Blank label="On" />
        </div>
        <p className="text-sm text-stone-700">{workbookHowTo("circle")}</p>
        <p className="text-sm text-stone-700">{WORKBOOK_AFTER}</p>
      </header>

      <Section title="The five levels" className="wb-keep">
        <p className="text-sm text-stone-700">{WORKBOOK_LEVELS_NOTE}</p>
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]" data-testid="workbook-levels">
          {CANVAS_LEVELS.map((level) => (
            <div key={level} className="contents">
              <dt className="font-semibold text-stone-900">
                {level} {CANVAS_SCALE_TEXT[level].word}
              </dt>
              <dd className="text-stone-700">{CANVAS_SCALE_TEXT[level].meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="The four foundations" className="wb-keep">
        <dl className="space-y-2.5 text-sm" data-testid="workbook-foundations">
          {CANVAS_FOUNDATIONS.map((f) => (
            <div key={f}>
              <dt className="font-semibold text-stone-900">{CANVAS_FOUNDATION_TEXT[f].name}</dt>
              <dd className="text-stone-700">{CANVAS_FOUNDATION_TEXT[f].description}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <div className="space-y-6" data-testid="workbook-blocks">
        <h2 className="sr-only">The twelve blocks</h2>
        {CANVAS_ORDER.map((block) => (
          <BlockPage key={block.id} block={block} />
        ))}
      </div>

      <Section title="Decision Matrix" className="wb-keep wb-break">
        <p className="text-sm text-stone-700">{WORKBOOK_MATRIX_NOTE}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm" data-testid="workbook-matrix">
            <thead>
              <tr>
                {CANVAS_DECISION_MATRIX_COLUMNS.map((c) => (
                  <th key={c} scope="col" className="border border-stone-400 bg-stone-100 px-2 py-1.5 text-left font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: MATRIX_BLANK_ROWS }, (_, i) => (
                <tr key={i}>
                  {CANVAS_DECISION_MATRIX_COLUMNS.map((c) => (
                    <td key={c} className="h-12 border border-stone-400 px-2" />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Key moments" className="wb-keep">
        <p className="text-sm text-stone-700">{WORKBOOK_MOMENTS_NOTE}</p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-stone-800" data-testid="workbook-moments">
          {CANVAS_KEY_MOMENTS.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <div className="border-t border-stone-200 pt-3">
          <Credit testId="workbook-credit-end" />
        </div>
      </Section>
    </article>
  );
}
