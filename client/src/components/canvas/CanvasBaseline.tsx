/**
 * THE CANVAS BASELINE: where a village reads itself against the twelve
 * governance canvas blocks, and sees each block's newest reading.
 *
 * Mounted as the "Canvas" view on /journey-to-launch, for members and admins
 * alike (server/routes/canvas.ts answers an admitted member or an admin, and
 * refuses a signed-in account the village has not admitted with its own
 * sentence, which this view prints as it comes). Season Two
 * projects take their first reading of every block on Saturday 3 October,
 * and Rye ruled on 2026-09-24 that every block must be on record before a
 * village's Birthing.
 *
 * ── WHAT THIS VIEW MUST NEVER SHOW ─────────────────────────────────────────
 *
 * R55: no scorecard. The radar is the one exception Rye made, for the canvas
 * baseline only. So there is no averaged, summed or composite number here, no
 * percentage, no "so many of twelve" count, and no progress bar. A block with
 * no reading says so on its own card, and the radar walks every block in
 * canvas order whether it has been read or not.
 * client/src/lib/canvasCopy.test.ts reads every file in this directory and
 * fails on any of those shapes.
 *
 * ── THE CREDIT ─────────────────────────────────────────────────────────────
 *
 * The canvas is the work of the Bioregional Weaving Labs Collective and
 * Commonland, and the credit line renders with the radar every time. Rye
 * ruled the canvas's own wording built and switched on, credited: each card
 * leads with the canvas's question (shared/governanceCanvasText.ts), the
 * legend under the radar reads the canvas's scale words, and our own
 * questions and prompts stay on the card, labelled as ours. The credit says
 * which words are quoted, and it is the one place on this view that links out.
 *
 * Light only, by ruling. The network lives here; the cards and the form are
 * handed functions and hold no fetch of their own.
 */
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ExternalLink, Loader2, Printer } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import {
  CANVAS_CREDIT,
  CANVAS_LEVELS,
  LEVEL_WORDS,
  type CanvasBlockId,
  type CanvasReadingInput,
} from "@shared/governanceCanvas";
import { orderBlocks, seasonWeeksOf, type CanvasSeason } from "@shared/canvasSeason";
import { CANVAS_SCALE_TEXT } from "@shared/governanceCanvasText";
import { newestLevels, radarDescription, type CanvasBlockView, type CanvasPayload } from "@/lib/canvasCopy";
import { CanvasRadar } from "./CanvasRadar";
import { CanvasBlockCard } from "./CanvasBlockCard";

/**
 * The platform's half of the Decision Matrix, which the Power block hosts.
 * Its own chunk, loaded when the cards render: a member who never opens it
 * still pays for the code once, and the data only when they open it.
 */
const DecisionMatrix = lazy(() => import("./DecisionMatrix"));

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** A tab in the Journey to Launch header, styled like its neighbours. */
export function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-sm rounded-lg px-3 py-1.5 font-medium ${active ? "bg-amber text-foreground" : "bg-white/10 text-white"}`}
    >
      {children}
    </button>
  );
}

const EMPTY: CanvasBlockView[] = [];
const NO_FOCUS: readonly CanvasBlockId[] = [];

/**
 * `focus` is the season week's blocks (CanvasView reads them from the season
 * file). They come FIRST and carry `focusLabel`; every other block follows in
 * canvas order. It orders and never gates: `orderBlocks` returns all twelve
 * whatever it is handed, and every card keeps its form. With no focus, the
 * cards are in canvas order, as they always were.
 */
export function CanvasBaseline({
  focus = NO_FOCUS,
  focusLabel = "This week",
  season = null,
}: {
  focus?: readonly CanvasBlockId[];
  focusLabel?: string;
  /** The loaded season, when there is one: each card's week line is read from it. */
  season?: Pick<CanvasSeason, "name" | "weeks"> | null;
} = {}) {
  const [data, setData] = useState<CanvasPayload | null>(null);
  /** Why the read failed, and whether asking again could help: a refusal (401, 403) gets the same answer twice. */
  const [failed, setFailed] = useState<{ message: string; retry: boolean } | null>(null);

  const load = useCallback(() => {
    setFailed(null);
    fetch("/api/canvas", { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) return setData(d as CanvasPayload);
        if (r.status === 401 || d?.error === "auth_required") return setFailed({ message: "Sign in to read the canvas.", retry: false });
        if (r.status === 403 && typeof d?.error === "string" && d.error) return setFailed({ message: d.error, retry: false });
        setFailed({ message: "The canvas could not be read just now.", retry: true });
      })
      .catch(() => setFailed({ message: "The canvas could not be read just now.", retry: true }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** Resolves to null when the reading was kept, or to the sentence that refused it. */
  const save = async (reading: CanvasReadingInput): Promise<string | null> => {
    try {
      const r = await fetch("/api/canvas/readings", { method: "POST", headers: headers(), body: JSON.stringify(reading) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return String(d?.error ?? "That reading was not saved.");
      load();
      return null;
    } catch {
      return "That reading did not reach the server.";
    }
  };

  /** The Power block's Decision Matrix is open, so its card takes both columns. */
  const [matrixOpen, setMatrixOpen] = useState(false);

  const blocks = data?.blocks ?? EMPTY;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const levels = newestLevels(blocks);
  const inFocus = new Set<CanvasBlockId>(focus);

  return (
    <div className="space-y-6" data-testid="canvas-baseline">
      <section className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
        <header>
          <h2 className="font-display text-xl font-semibold text-stone-900">The canvas baseline</h2>
          <p className="text-sm text-stone-700 mt-1 max-w-2xl">
            Each block of the governance canvas asks how one part of this village is governed. A reading gives the
            block a level, from Absent to Thriving, and one sentence saying why. Every reading is kept, so the
            village can see where each block has moved.
          </p>
        </header>

        {failed ? (
          <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3 space-y-2">
            <p>{failed.message}</p>
            {failed.retry && (
              <button
                type="button"
                onClick={load}
                className="text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep bg-white hover:bg-stone-50"
              >
                Try again
              </button>
            )}
          </div>
        ) : !data ? (
          <p className="text-sm text-stone-600 py-8 text-center">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            Reading the canvas
          </p>
        ) : (
          <>
            <CanvasRadar levels={levels} description={radarDescription(levels, LEVEL_WORDS)} />
            {/* The canvas's own scale, ring by ring from the centre outward.
                Words only: a numeral beside each ring would read as points. */}
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-stone-700" data-testid="canvas-scale-legend">
              {CANVAS_LEVELS.map((level) => (
                <li key={level}>
                  <span className="font-semibold text-stone-900">{CANVAS_SCALE_TEXT[level].word}</span>:{" "}
                  {CANVAS_SCALE_TEXT[level].meaning}
                </li>
              ))}
            </ul>
            <p className="text-xs text-stone-600 text-center">
              The rings run from {CANVAS_SCALE_TEXT[1].word} at the centre to {CANVAS_SCALE_TEXT[5].word} at the edge. A
              block with no reading yet runs to the centre and its name is in italics.
            </p>
          </>
        )}

        <div className="text-xs text-stone-600 border-t border-stone-100 pt-3 space-y-2" data-testid="canvas-credit">
          <p>
            {/* An INLINE link, never inline-flex: the credit wraps over three
                lines on a phone, and a flex box would push the full stop after
                it onto a line of its own. */}
            Each block's question and description, and the words for the five levels, are quoted from the{" "}
            <a href={CANVAS_CREDIT.url} target="_blank" rel="noreferrer" className="font-medium text-stone-800 hover:underline">
              {CANVAS_CREDIT.text}
              <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
            </a>
            . The questions under "Our questions to talk through" are this platform's own.
          </p>
          <p>
            <Link href="/canvas/workbook" className="inline-flex items-center gap-1 font-medium text-teal-deep hover:underline">
              <Printer className="w-3 h-3" /> Print the canvas workbook
            </Link>{" "}
            to talk it through on paper first.
          </p>
        </div>
      </section>

      {data && (
        // Dense, so a card that takes both columns (the Power block with its
        // matrix open) leaves no empty cell behind it. With every card one
        // column wide, dense changes nothing.
        <div className="grid gap-4 md:grid-cols-2 md:grid-flow-row-dense">
          {orderBlocks(focus).map((block) => (
            <CanvasBlockCard
              key={block.id}
              block={block}
              view={byId.get(block.id) ?? { id: block.id, latest: null, history: [] }}
              mayRecord={!!data.mayRecord}
              onSave={save}
              focusLabel={inFocus.has(block.id) ? focusLabel : undefined}
              season={season ? { name: season.name, weeks: seasonWeeksOf(season, block.id) } : undefined}
              wide={block.id === "power" && matrixOpen}
            >
              {block.id === "power" && (
                <Suspense fallback={null}>
                  <DecisionMatrix onOpenChange={setMatrixOpen} />
                </Suspense>
              )}
            </CanvasBlockCard>
          ))}
        </div>
      )}
    </div>
  );
}
