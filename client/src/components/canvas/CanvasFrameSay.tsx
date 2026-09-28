/**
 * THE SAY FRAME: the village's answer to one canvas block, in its own words,
 * and the box where anybody in the village suggests a change to it (plan 2.3;
 * Wave 3b, 2026-09-28).
 *
 * WHAT THE ANSWER IS, per block:
 *
 *   every block      its brief sections as GET /api/canvas/blocks/:id serves
 *                    them to this viewer: adopted, a draft, nothing written,
 *                    written and not opened to members, or kept with the
 *                    administrators. A section the viewer may not read shows
 *                    its state and never its words.
 *   Purpose (1)      the governing purpose statement above the sections.
 *   Power (7)        the Decision Matrix: the platform's generated half
 *                    (DecisionMatrix, its own lazy chunk) and the village's
 *                    own rows beneath it (DecisionMatrixRows), which the
 *                    consequence pen writes and anybody else suggests.
 *   Conflict (8)     the conflict agreement's editor
 *                    (ConflictAgreementEditor, lazy, the same chunk the
 *                    governance page loads). The editor asks the server who
 *                    may save and offers only what will work.
 *
 * Suggesting is free (Rye, 2026-09-24 and 2026-09-25): the box is offered to
 * every member and every administrator alike, and the power question is asked
 * only when somebody adopts. Notes are public (2026-09-23), and the box says
 * so above its first field, before anybody types.
 */
import { lazy, Suspense, useState } from "react";
import { Link } from "wouter";
import { readingDate } from "@/lib/canvasCopy";
import { SECTION_STATUS_WORDS, type BlockFramesPayload, type FrameId } from "@/lib/canvasFramesCopy";
import { CanvasSuggestionForm } from "./CanvasSuggestionForm";
import { DecisionMatrixRows } from "./DecisionMatrixRows";

const DecisionMatrix = lazy(() => import("./DecisionMatrix"));
const ConflictAgreementEditor = lazy(() => import("./ConflictAgreementEditor"));

const waiting = <p className="text-sm text-stone-600">Opening</p>;

export function CanvasFrameSay({
  payload,
  onChanged,
  onGoTo,
}: {
  payload: BlockFramesPayload;
  /** Something was written: say so, and read the block again. */
  onChanged: (message?: string) => void;
  onGoTo: (frame: FrameId) => void;
}) {
  const [sent, setSent] = useState(false);
  const { block, answer } = payload;

  return (
    <section aria-label={`Say: the village's answer on ${block.name}`} className="space-y-5 text-sm">
      {answer.purposeStatement !== undefined && (
        <div className="rounded-lg border border-stone-200 p-3" data-testid="canvas-say-purpose">
          <h4 className="font-semibold text-stone-900">The governing purpose statement</h4>
          {answer.purposeStatement ? (
            <>
              <p className="mt-1 whitespace-pre-wrap text-stone-900">{answer.purposeStatement.statement}</p>
              <p className="mt-1 text-xs text-stone-600">Written on {readingDate(answer.purposeStatement.writtenAt)}</p>
            </>
          ) : (
            <p className="mt-1 text-stone-700">Not written yet.</p>
          )}
        </div>
      )}

      {answer.sections.length > 0 && (
        <ul className="space-y-3" data-testid="canvas-say-sections">
          {answer.sections.map((s) => (
            <li key={s.id} className="rounded-lg border border-stone-200 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="font-semibold text-stone-900">{s.title}</h4>
                <span className="text-xs font-medium text-stone-600">{SECTION_STATUS_WORDS[s.status]}</span>
              </div>
              {s.body && <p className="mt-1 whitespace-pre-wrap text-stone-800">{s.body}</p>}
              {s.body && s.updatedAt && <p className="mt-1 text-xs text-stone-600">Last changed on {readingDate(s.updatedAt)}</p>}
            </li>
          ))}
        </ul>
      )}

      {block.elsewhere && (
        <p className="text-stone-700">
          {block.elsewhere.note}{" "}
          <Link href={block.elsewhere.href} className="font-medium text-teal-deep hover:underline">
            {block.elsewhere.label}
          </Link>
        </p>
      )}

      {block.id === "conflict" && (
        <div className="space-y-2" data-testid="canvas-say-agreement">
          <h4 className="font-semibold text-stone-900">The conflict agreement</h4>
          <Suspense fallback={waiting}>
            <ConflictAgreementEditor onDone={() => onChanged()} />
          </Suspense>
        </div>
      )}

      {block.id === "power" && (
        <div className="space-y-3" data-testid="canvas-say-matrix">
          <Suspense fallback={waiting}>
            <DecisionMatrix />
          </Suspense>
          {/* Read again whenever the block is: this frame stays mounted while
              the pen adopts a row under Adopt, and the new row belongs here. */}
          <DecisionMatrixRows notesArePublic={payload.notesArePublic} reloadOn={payload} />
        </div>
      )}

      <CanvasSuggestionForm
        payload={payload}
        onSent={() => {
          setSent(true);
          onChanged("Your suggestion is open. It is listed under Adopt, with your name and today's date, until it is decided.");
        }}
      />
      {sent && (
        <button
          type="button"
          onClick={() => onGoTo("adopt")}
          className="text-sm font-medium rounded-lg px-3 min-h-[44px] text-teal-deep border border-teal-deep bg-white hover:bg-stone-50"
        >
          Go to Adopt
        </button>
      )}
    </section>
  );
}
