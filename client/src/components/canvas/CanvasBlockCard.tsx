/**
 * One canvas block: the canvas's own question, its newest reading in words,
 * who gave it and when, and the block's five frames behind "Open this block".
 *
 * THE FIVE FRAMES (Wave 3b, 2026-09-28) open under the card, one at a time:
 * Sense, See, Learn, Say and Adopt (CanvasBlockFrames, its own lazy chunk).
 * The readings before the newest and the reading form moved into Sense. The
 * pen keeps "Record a reading" on the closed card, because the first reading
 * of all twelve blocks is taken in one sitting, and it opens the block on
 * Sense with the form already open. An open block takes both columns of the
 * grid on a wide screen, so its forms and the Decision Matrix have the room.
 *
 * TWO VOICES ON ONE CARD, and each is labelled. The canvas's question leads,
 * quoted with a `cite` back to where it was published, and its description
 * opens on demand. Our own question and prompts (shared/governanceCanvas.ts)
 * sit beneath under "Our questions to talk through", so a reader always knows
 * whose words they are reading. The credit line renders once, on the view
 * that holds the cards (CanvasBaseline), and not twelve times.
 *
 * "Ask" (Wave 4) opens the companion on this block, when the card sits inside
 * the Canvas view's companion; anywhere else the button is not drawn.
 *
 * The level shows as its WORD. The radar above already places it on a ring,
 * and a numeral here would invite adding the twelve up, which R55 forbids.
 * The earlier readings (in Sense) are listed without a count for the same
 * reason.
 */
import { lazy, Suspense, useState } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { type CanvasBlock, type CanvasReadingInput } from "@shared/governanceCanvas";
import { CANVAS_BLOCK_TEXT, CANVAS_FOUNDATION_TEXT, CANVAS_SOURCE_URL } from "@shared/governanceCanvasText";
import { recordedLine, weeksPhrase, type CanvasBlockView } from "@/lib/canvasCopy";
import { AskButton } from "@/components/companion/Companion";

/** The five frames: their own chunk, fetched the first time any block is opened. */
const CanvasBlockFrames = lazy(() => import("./CanvasBlockFrames"));

export function CanvasBlockCard({
  block,
  view,
  mayRecord,
  onSave,
  focusLabel,
  season,
}: {
  block: CanvasBlock;
  view: CanvasBlockView;
  mayRecord: boolean;
  onSave: (reading: CanvasReadingInput) => Promise<string | null>;
  /** Set when the season's week puts this block first: a tag, never a lock. */
  focusLabel?: string;
  /**
   * The loaded season's name and the weeks it names this block in. The card's
   * week line reads these, so it says what the week map above it says. With
   * no season loaded there is no week line: a village that runs no season has
   * no weeks, and another programme's calendar is not this village's.
   */
  season?: { name: string; weeks: readonly number[] };
}) {
  /** Closed (null), or open, and whether the reading form starts open. */
  const [open, setOpen] = useState<{ recording: boolean } | null>(null);
  const latest = view.latest;
  const canvas = CANVAS_BLOCK_TEXT[block.id];

  return (
    <article
      id={`canvas-block-${block.id}`}
      data-testid={`canvas-block-${block.id}`}
      className={`bg-white border rounded-xl p-5 scroll-mt-24 ${focusLabel ? "border-teal-deep" : "border-stone-200"}${open ? " md:col-span-2" : ""}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Block {block.number}
            {focusLabel && <span className="ml-2 normal-case tracking-normal font-semibold text-teal-deep">{focusLabel}</span>}
          </p>
          <h3 className="font-semibold text-stone-900">{block.name}</h3>
        </div>
        {latest ? (
          <span className="shrink-0 text-xs font-semibold rounded-full px-2.5 py-1 bg-teal-deep text-white">
            {latest.word}
          </span>
        ) : (
          <span className="shrink-0 text-xs font-medium rounded-full px-2.5 py-1 border border-stone-300 text-stone-600">
            No reading yet
          </span>
        )}
      </header>

      <p className="mt-2 text-xs font-medium text-stone-600">The canvas asks</p>
      <blockquote cite={CANVAS_SOURCE_URL} className="text-sm font-medium text-stone-900" data-testid={`canvas-question-${block.id}`}>
        {canvas.question}
      </blockquote>
      <details className="mt-1.5 text-sm">
        <summary className="cursor-pointer font-medium text-teal-deep">What the canvas says about it</summary>
        {/* Italic, so the canvas's words never read as a reading, which sits
            just below with the same rule on its left. */}
        <blockquote cite={CANVAS_SOURCE_URL} className="mt-2 italic text-stone-700 border-l-2 border-stone-200 pl-3">
          {canvas.description}
        </blockquote>
      </details>

      {latest && (
        <div className="mt-3">
          <p className="text-sm text-stone-900 border-l-2 border-teal-deep pl-3">{latest.sentence}</p>
          <p className="text-xs text-stone-600 mt-1.5">{recordedLine(latest)}</p>
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-teal-deep">Our questions to talk through</summary>
        <p className="mt-2 text-stone-900">{block.question}</p>
        <ul className="mt-2 space-y-1.5 list-disc pl-5 text-stone-700">
          {block.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-stone-600">
          {block.foundations.map((f) => CANVAS_FOUNDATION_TEXT[f].name).join(" · ")}
          {season && season.weeks.length > 0 && ` · ${season.name}: ${weeksPhrase(season.weeks)}`}
        </p>
      </details>

      {block.elsewhere && (
        <p className="mt-3 text-xs text-stone-600">
          {block.elsewhere.note}{" "}
          <Link href={block.elsewhere.href} className="inline-flex items-center gap-0.5 font-medium text-teal-deep hover:underline">
            {block.elsewhere.label} <ChevronRight className="w-3 h-3" />
          </Link>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {mayRecord && !open && (
          <button
            type="button"
            onClick={() => setOpen({ recording: true })}
            className="min-h-[44px] text-sm font-medium rounded-lg px-3 text-teal-deep border border-teal-deep hover:bg-stone-50"
          >
            Record a reading
          </button>
        )}
        <button
          type="button"
          aria-expanded={!!open}
          aria-controls={`canvas-frames-region-${block.id}`}
          aria-label={`${open ? "Close this block" : "Open this block"}: ${block.name}`}
          onClick={() => setOpen(open ? null : { recording: false })}
          className={`min-h-[44px] text-sm font-medium rounded-lg px-3 border ${
            open ? "text-stone-800 border-stone-300 hover:bg-stone-50" : "text-white bg-teal-deep border-teal-deep"
          }`}
        >
          {open ? "Close this block" : "Open this block"}
        </button>
        <AskButton block={block.id} label="Ask" name={`Ask about ${block.name}`} />
      </div>

      <div id={`canvas-frames-region-${block.id}`}>
        {open && (
          <Suspense fallback={<p className="mt-4 text-sm text-stone-600">Opening {block.name}</p>}>
            <CanvasBlockFrames
              block={block}
              view={view}
              mayRecord={mayRecord}
              onSaveReading={onSave}
              startRecording={open.recording}
            />
          </Suspense>
        )}
      </div>
    </article>
  );
}
