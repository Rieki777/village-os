/**
 * One canvas block: its question, its newest reading in words, who gave it and
 * when, the readings before it, and for the pen a way to add another.
 *
 * The level shows as its WORD. The radar above already places it on a ring,
 * and a numeral here would invite adding the twelve up, which R55 forbids.
 * The earlier readings are listed without a count for the same reason.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { FOUNDATION_LABELS, type CanvasBlock, type CanvasReadingInput } from "@shared/governanceCanvas";
import { recordedLine, weeksPhrase, type CanvasBlockView } from "@/lib/canvasCopy";
import { RecordReadingForm } from "./RecordReadingForm";

export function CanvasBlockCard({
  block,
  view,
  mayRecord,
  onSave,
  focusLabel,
}: {
  block: CanvasBlock;
  view: CanvasBlockView;
  mayRecord: boolean;
  onSave: (reading: CanvasReadingInput) => Promise<string | null>;
  /** Set when the season's week puts this block first: a tag, never a lock. */
  focusLabel?: string;
}) {
  const [writing, setWriting] = useState(false);
  const latest = view.latest;
  const earlier = view.history.slice(1);

  return (
    <article
      id={`canvas-block-${block.id}`}
      data-testid={`canvas-block-${block.id}`}
      className={`bg-white border rounded-xl p-5 scroll-mt-24 ${focusLabel ? "border-teal-deep" : "border-stone-200"}`}
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

      <p className="text-sm text-stone-700 mt-2">{block.question}</p>

      {latest && (
        <div className="mt-3">
          <p className="text-sm text-stone-900 border-l-2 border-teal-deep pl-3">{latest.sentence}</p>
          <p className="text-xs text-stone-600 mt-1.5">{recordedLine(latest)}</p>
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-teal-deep">Questions to talk through</summary>
        <ul className="mt-2 space-y-1.5 list-disc pl-5 text-stone-700">
          {block.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-stone-600">
          {block.foundations.map((f) => FOUNDATION_LABELS[f]).join(" · ")}
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
