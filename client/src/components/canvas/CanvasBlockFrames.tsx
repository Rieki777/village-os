/**
 * ONE CANVAS BLOCK, WALKED IN FIVE FRAMES (plan 2.3, "Five frames"; Wave 3b,
 * 2026-09-28): Sense, See, Learn, Say and Adopt, one at a time, under the
 * block's own card on the Canvas view.
 *
 *   Sense  the block's earlier readings, and for the pen the reading form,
 *          moved in from the card. It needs nothing but what GET /api/canvas
 *          already sent the card, so opening a block on Sense asks the server
 *          for nothing: at the first reading the pen reads all twelve blocks
 *          in a row, and none of them costs a request.
 *   See    what the live system already shows (the server's plain facts, each
 *          with its control), where the words and the settings part, and the
 *          settings behind the block.
 *   Learn  a slot the resources lane fills later. Until then it says plainly
 *          what is not built, and links only to what exists.
 *   Say    the village's answer, and the suggestion box (CanvasFrameSay).
 *   Adopt  the open suggestions and the pen's decision (CanvasFrameAdopt).
 *
 * The block itself (GET /api/canvas/blocks/:id) is read the first time See,
 * Say or Adopt opens, and again after anything is suggested, adopted or
 * declined. docs/canvas-api.md is the contract.
 *
 * LAZY: CanvasBlockCard imports this file with `lazy()`, so a member who only
 * reads the baseline never downloads the frames.
 *
 * THE FRAME BUTTONS ARE BUTTONS. Pressed state is `aria-pressed`, the same as
 * the view tabs on Journey to Launch, and each is at least 44px tall on a
 * phone. The Sense form and the See facts carry no number but a date and the
 * server's own sentences: client/src/lib/canvasCopy.test.ts reads this file.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ExternalLink, Loader2, Printer } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { recordedLine, type CanvasBlockView } from "@/lib/canvasCopy";
import { FRAME_IDS, FRAMES, gapFacts, readFailure, type BlockFramesPayload, type FrameId } from "@/lib/canvasFramesCopy";
import { type CanvasBlock, type CanvasReadingInput } from "@shared/governanceCanvas";
import { CANVAS_SOURCE_URL } from "@shared/governanceCanvasText";
import { RecordReadingForm } from "./RecordReadingForm";
import { CanvasFrameSay } from "./CanvasFrameSay";
import { CanvasFrameAdopt } from "./CanvasFrameAdopt";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const quiet = "text-sm font-medium rounded-lg px-3 min-h-[44px] text-teal-deep border border-teal-deep bg-white hover:bg-stone-50";

export interface CanvasBlockFramesProps {
  block: CanvasBlock;
  /** The block's readings, newest first, as GET /api/canvas sent them to the card. */
  view: CanvasBlockView;
  /** Whether this person holds the canvas pen (`mayRecord` on GET /api/canvas). */
  mayRecord: boolean;
  /** Sends a reading. Resolves to null when saved, or to the sentence that refused it. */
  onSaveReading: (reading: CanvasReadingInput) => Promise<string | null>;
  /** The frame the block opens on. */
  initialFrame?: FrameId;
  /** Open the reading form straight away (the card's "Record a reading"). */
  startRecording?: boolean;
}

export default function CanvasBlockFrames({
  block,
  view,
  mayRecord,
  onSaveReading,
  initialFrame = "sense",
  startRecording = false,
}: CanvasBlockFramesProps) {
  const [frame, setFrame] = useState<FrameId>(initialFrame);
  const [payload, setPayload] = useState<BlockFramesPayload | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const asked = useRef(false);

  const load = useCallback(() => {
    asked.current = true;
    setFailed(null);
    fetch(`/api/canvas/blocks/${block.id}`, { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return setFailed(readFailure(r.status, d?.error, "this block"));
        setPayload(d as BlockFramesPayload);
      })
      .catch(() => setFailed(readFailure(null, null, "this block")));
  }, [block.id]);

  // Sense needs nothing the card does not already hold, and Learn nothing at
  // all; See, Say and Adopt need the block.
  useEffect(() => {
    if (frame !== "sense" && frame !== "learn" && !asked.current) load();
  }, [frame, load]);

  /** After a suggestion, an adoption or a decline: say what happened and read the block again. */
  const changed = (message?: string) => {
    setNotice(message ?? null);
    load();
  };

  const go = (next: FrameId) => {
    setNotice(null);
    setFrame(next);
  };

  return (
    <div className="mt-4 border-t border-stone-100 pt-4 space-y-3" data-testid={`canvas-frames-${block.id}`}>
      {/* Five buttons on one line at 390px: the card leaves about 318px, and
          px-3 with gap-2 came to 320 and pushed Adopt onto a line of its own. */}
      <div role="group" aria-label={`The five frames of ${block.name}`} className="flex flex-wrap gap-1.5">
        {FRAME_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={frame === id}
            onClick={() => go(id)}
            className={`min-h-[44px] rounded-lg px-2.5 text-sm font-medium border ${
              frame === id ? "bg-teal-deep text-white border-teal-deep" : "bg-white text-stone-800 border-stone-300 hover:bg-stone-50"
            }`}
          >
            {FRAMES[id].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-stone-600">{FRAMES[frame].intro}</p>

      {notice && (
        <p role="status" className="text-sm rounded-lg bg-teal-deep/10 text-stone-900 px-3 py-2">
          {notice}
        </p>
      )}

      {frame === "sense" ? (
        <SenseFrame block={block} view={view} mayRecord={mayRecord} onSave={onSaveReading} startRecording={startRecording} />
      ) : frame === "learn" ? (
        <LearnFrame block={block} />
      ) : failed ? (
        <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3 space-y-2">
          <p>{failed.message}</p>
          {failed.retry && (
            <button type="button" onClick={load} className={quiet}>
              Try again
            </button>
          )}
        </div>
      ) : !payload ? (
        <p className="text-sm text-stone-600 py-4 text-center">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Reading {block.name}
        </p>
      ) : frame === "see" ? (
        <SeeFrame payload={payload} />
      ) : frame === "say" ? (
        <CanvasFrameSay payload={payload} onChanged={changed} onGoTo={go} />
      ) : (
        <CanvasFrameAdopt payload={payload} onChanged={changed} onGoTo={go} />
      )}
    </div>
  );
}

/** Sense: the readings before the newest, and the pen's form. The newest stays on the card above. */
function SenseFrame({
  block,
  view,
  mayRecord,
  onSave,
  startRecording,
}: {
  block: CanvasBlock;
  view: CanvasBlockView;
  mayRecord: boolean;
  onSave: (reading: CanvasReadingInput) => Promise<string | null>;
  startRecording: boolean;
}) {
  const [writing, setWriting] = useState(startRecording && mayRecord);
  const earlier = view.history.slice(1);

  return (
    <section aria-label={`Sense: readings of ${block.name}`} className="space-y-3 text-sm">
      {earlier.length > 0 ? (
        <>
          <h4 className="font-semibold text-stone-900">Earlier readings</h4>
          <ul className="space-y-2">
            {earlier.map((r) => (
              <li key={r.id} className="text-stone-700">
                <span className="font-medium text-stone-900">{r.word}</span>. {r.sentence}
                <span className="block text-xs text-stone-600">{recordedLine(r)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-stone-700">
          {view.latest ? `The reading above is the first one of ${block.name}.` : `Nobody has read ${block.name} yet.`}
        </p>
      )}

      {mayRecord && !writing && (
        <button type="button" onClick={() => setWriting(true)} className={quiet}>
          Record a reading
        </button>
      )}
      {mayRecord && writing && (
        <RecordReadingForm
          block={block}
          firstReading={!view.latest}
          onCancel={() => setWriting(false)}
          onSave={async (reading) => {
            const refused = await onSave(reading);
            if (!refused) setWriting(false);
            return refused;
          }}
        />
      )}
    </section>
  );
}

/** See: the server's facts, where the words and the settings part, and the settings behind the block. */
function SeeFrame({ payload }: { payload: BlockFramesPayload }) {
  const gaps = gapFacts(payload);
  const name = payload.block.name;
  return (
    <section aria-label={`See: what the village shows about ${name}`} className="space-y-4 text-sm">
      <div>
        <h4 className="font-semibold text-stone-900">What the village's settings and records show</h4>
        {payload.observed.length > 0 ? (
          <ul className="mt-2 space-y-2" data-testid="canvas-see-facts">
            {payload.observed.map((f) => (
              <li key={f.id} className="text-stone-800">
                {f.text}{" "}
                <Link href={f.href} className="font-medium text-teal-deep hover:underline">
                  {f.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-stone-700">Nothing the village runs speaks to {name} yet.</p>
        )}
      </div>

      {gaps.length > 0 && (
        <div>
          <h4 className="font-semibold text-stone-900">Where the words and the settings part</h4>
          <ul className="mt-2 space-y-2 list-disc pl-5" data-testid="canvas-see-gaps">
            {gaps.map((g) => (
              <li key={g.id} className="text-stone-800">
                {g.text}
                {g.href && (
                  <>
                    {" "}
                    <Link href={g.href} className="font-medium text-teal-deep hover:underline">
                      {g.label}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {payload.doors.length > 0 && (
        <div>
          <h4 className="font-semibold text-stone-900">The settings behind this block</h4>
          <ul className="mt-2 space-y-2" data-testid="canvas-see-doors">
            {payload.doors.map((d) => (
              <li key={d.label} className="text-stone-800">
                <span className="font-medium text-stone-900">{d.label}.</span>{" "}
                {d.wired ? "Anybody in the village can suggest a change to it under Say." : d.why}{" "}
                <Link href={d.href} className="font-medium text-teal-deep hover:underline">
                  Where it is set
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Learn: the slot the resources lane fills (plan 5). Nothing here pretends to
 * be built: the readings picked per block and "Ask about this" do not exist
 * yet, and the page says so. The knowledge shelf has no page a member can
 * open today, so there is no link to it. What exists is linked.
 */
function LearnFrame({ block }: { block: CanvasBlock }) {
  return (
    <section aria-label={`Learn about ${block.name}`} className="space-y-3 text-sm text-stone-800">
      <p data-testid="canvas-learn-not-built">
        Readings and tools picked for {block.name}, and a way to ask a question about it, are not built yet.
      </p>
      <ul className="space-y-2">
        <li>
          <a href={CANVAS_SOURCE_URL} target="_blank" rel="noreferrer" className="font-medium text-teal-deep hover:underline">
            The canvas's own article
            <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
          </a>
          , where its authors describe the canvas.
        </li>
        <li>
          <Link href="/canvas/workbook" className="font-medium text-teal-deep hover:underline">
            <Printer className="inline w-3 h-3 mr-1 align-[-1px]" aria-hidden="true" />
            Print the canvas workbook
          </Link>{" "}
          to talk {block.name} through on paper. The questions under "Our questions to talk through" on this card are there too.
        </li>
      </ul>
    </section>
  );
}
