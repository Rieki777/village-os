/**
 * One canvas block: the canvas's own question, its newest reading in words,
 * who gave it and when, the readings before it, and for the pen a way to add
 * another.
 *
 * TWO VOICES ON ONE CARD, and each is labelled. The canvas's question leads,
 * quoted with a `cite` back to where it was published, and its description
 * opens on demand. Our own question and prompts (shared/governanceCanvas.ts)
 * sit beneath under "Our questions to talk through", so a reader always knows
 * whose words they are reading. The credit line renders once, on the view
 * that holds the cards (CanvasBaseline), and not twelve times.
 *
 * The level shows as its WORD. The radar above already places it on a ring,
 * and a numeral here would invite adding the twelve up, which R55 forbids.
 * The earlier readings are listed without a count for the same reason.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { type CanvasBlock, type CanvasReadingInput } from "@shared/governanceCanvas";
import { CANVAS_BLOCK_TEXT, CANVAS_FOUNDATION_TEXT, CANVAS_SOURCE_URL } from "@shared/governanceCanvasText";
import { recordedLine, weeksPhrase, type CanvasBlockView } from "@/lib/canvasCopy";
import { RecordReadingForm } from "./RecordReadingForm";

export function CanvasBlockCard({
  block,
  view,
  mayRecord,
  onSave,
}: {
  block: CanvasBlock;
  view: CanvasBlockView;
  mayRecord: boolean;
  onSave: (reading: CanvasReadingInput) => Promise<string | null>;
}) {
  const [writing, setWriting] = useState(false);
  const latest = view.latest;
  const earlier = view.history.slice(1);
  const canvas = CANVAS_BLOCK_TEXT[block.id];

  return (
    <article data-testid={`canvas-block-${block.id}`} className="bg-white border border-stone-200 rounded-xl p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Block {block.number}</p>
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
          {block.seasonWeeks.length > 0 && ` · Season Two, ${weeksPhrase(block.seasonWeeks)}`}
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

      {earlier.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-teal-deep">Earlier readings</summary>
          <ul className="mt-2 space-y-2">
            {earlier.map((r) => (
              <li key={r.id} className="text-stone-700">
                <span className="font-medium text-stone-900">{r.word}</span>. {r.sentence}
                <span className="block text-xs text-stone-600">{recordedLine(r)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {mayRecord && !writing && (
        <button
          type="button"
          onClick={() => setWriting(true)}
          className="mt-4 text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep hover:bg-stone-50"
        >
          Record a reading
        </button>
      )}
      {mayRecord && writing && (
        <RecordReadingForm
          block={block}
          firstReading={!latest}
          onCancel={() => setWriting(false)}
          onSave={async (reading) => {
            const refused = await onSave(reading);
            if (!refused) setWriting(false);
            return refused;
          }}
        />
      )}
    </article>
  );
}
