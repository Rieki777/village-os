/**
 * THE SEASON PANEL: the week map a village has laid over its canvas, and for
 * the canvas pen, the form that loads one (2026-09-26).
 *
 * A season is a file whoever runs the season hands the village (a cohort
 * programme ships one; a village can write its own). It names each week's
 * blocks, and the Canvas view puts those blocks first. It ORDERS and never
 * gates: every card below stays on the page and open every week, and nothing
 * here says a block is late or locked. The format, the validator and the date
 * arithmetic are shared/canvasSeason.ts; the network lives in CanvasView.
 *
 * The loading form checks a pasted or chosen file with the SAME validator the
 * server runs, so a person sees the server's own sentences before anything is
 * sent, and sees the season exactly as it will be stored before saving it.
 *
 * The pen can always get back to having no season: "Take the season off"
 * is offered whenever a season document is stored, including one that no
 * longer reads (an older release, a restore, a hand edit), which would
 * otherwise leave every member a red line on every visit. Taking it off
 * deletes the document, so the pen can download the stored file first.
 *
 * Light only, by ruling. No count, no percentage and no "so many of" here,
 * like every file in this directory (client/src/lib/canvasCopy.test.ts).
 */
import { useMemo, useState, type ChangeEvent } from "react";
import { CalendarDays, Moon } from "lucide-react";
import { CANVAS_BLOCKS, type CanvasBlockId } from "@shared/governanceCanvas";
import { CANVAS_FOUNDATION_TEXT } from "@shared/governanceCanvasText";
import {
  parseCanvasSeason,
  seasonDateLabel,
  seasonFileRefusal,
  seasonMoment,
  seasonTimeline,
  todayIn,
  type CanvasSeason,
  type CanvasSeasonPayload,
  type CanvasSeasonWeek,
  type SeasonMoment,
} from "@shared/canvasSeason";

/** Each block a week or a moon names, as a link down to its card. */
function BlockLinks({ blocks }: { blocks: readonly CanvasBlockId[] }) {
  if (!blocks[0]) return null;
  return (
    <p className="flex flex-wrap gap-1.5 mt-2">
      {blocks.map((id) => (
        <a
          key={id}
          href={`#canvas-block-${id}`}
          className="text-xs font-medium rounded-full px-2.5 py-1 border border-teal-deep text-teal-deep hover:bg-stone-50"
        >
          {CANVAS_BLOCKS[id].name}
        </a>
      ))}
    </p>
  );
}

function WeekDetail({ week }: { week: CanvasSeasonWeek }) {
  return (
    <div className="mt-2 space-y-2 text-sm text-stone-700">
      <BlockLinks blocks={week.blocks} />
      {week.foundations[0] && (
        // The canvas's own names, the same the block cards below use.
        <p className="text-xs text-stone-600">Foundations: {week.foundations.map((f) => CANVAS_FOUNDATION_TEXT[f].name).join(", ")}</p>
      )}
      {week.tools[0] && <p className="text-xs text-stone-600">Tools: {week.tools.join("; ")}</p>}
      {week.actions[0] && (
        <ul className="list-disc pl-5 space-y-1">
          {week.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {week.showcaseAsk && (
        <p className="border-l-2 border-amber pl-3 text-stone-900">
          <span className="font-medium">The week asks: </span>
          {week.showcaseAsk}
        </p>
      )}
    </div>
  );
}

/** One line saying where today falls in the season. */
function momentLine(moment: SeasonMoment, season: CanvasSeason): string {
  const order = (w: CanvasSeasonWeek) =>
    w.blocks[0] ? "Its blocks come first on the canvas below." : "It names no blocks, so the canvas below is in canvas order.";
  if (moment.phase === "during" && moment.week) {
    return `This week is week ${moment.week.number}, ${seasonDateLabel(moment.week.date)}: ${moment.week.title}. ${order(moment.week)}`;
  }
  if (moment.phase === "before" && moment.next) {
    return `The season starts on ${seasonDateLabel(moment.next.date, true)} with ${moment.next.title}. ${order(moment.next)}`;
  }
  const last = season.weeks[season.weeks.length - 1];
  return last
    ? `The season ended after ${last.title} on ${seasonDateLabel(last.date, true)}. The canvas below is back in canvas order.`
    : "The canvas below is in canvas order.";
}

function WeekMap({ season, moment }: { season: CanvasSeason; moment: SeasonMoment }) {
  const current = moment.phase === "during" ? moment.week : null;
  const upcoming = moment.phase === "before" ? moment.next : null;
  return (
    <ol className="space-y-2" aria-label="The season, week by week">
      {seasonTimeline(season).map((entry) => {
        if (entry.kind === "moon") {
          return (
            <li key={`moon-${entry.date}-${entry.moon.note}`} className="rounded-lg bg-stone-50 px-4 py-3">
              <p className="text-sm font-medium text-stone-900 flex items-center gap-2">
                {/* "Canvas moon": the day the season file sets for a new reading.
                    "New moon" was a claim about the sky, and a file's date need not
                    match the sky's in the season's own timezone. */}
                <Moon className="w-3.5 h-3.5 text-teal-deep" /> Canvas moon, {seasonDateLabel(entry.date)}
              </p>
              {entry.moon.note && <p className="text-sm text-stone-700 mt-1">{entry.moon.note}</p>}
              <BlockLinks blocks={entry.moon.blocks} />
            </li>
          );
        }
        const w = entry.week;
        const isCurrent = current === w;
        const isUpcoming = upcoming === w;
        return (
          <li
            key={`week-${w.number}`}
            data-testid={`season-week-${w.number}`}
            aria-current={isCurrent ? "date" : undefined}
            className={`rounded-lg border px-4 py-3 ${isCurrent ? "border-teal-deep bg-teal-deep/5" : "border-stone-200"}`}
          >
            <details open={isCurrent || isUpcoming}>
              <summary className="cursor-pointer text-sm">
                <span className="font-semibold text-stone-900">Week {w.number}</span>
                <span className="text-stone-600">, {seasonDateLabel(w.date)}: </span>
                <span className="text-stone-900">{w.title}</span>
                {isCurrent && (
                  <span className="ml-2 text-xs font-semibold rounded-full px-2 py-0.5 bg-teal-deep text-white">This week</span>
                )}
                {isUpcoming && (
                  <span className="ml-2 text-xs font-semibold rounded-full px-2 py-0.5 border border-teal-deep text-teal-deep">Next</span>
                )}
              </summary>
              <WeekDetail week={w} />
            </details>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The pen's form. Check first, then save: the preview is the season exactly
 * as the server will store it, and the refusal is the validator's own words.
 */
function LoadSeasonForm({
  onSave,
  hasSeason,
}: {
  onSave: (season: CanvasSeason) => Promise<string | null>;
  hasSeason: boolean;
}) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ season: CanvasSeason; ignored: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Closed until the pen opens it: a village in no programme meets one line, never an empty form. */
  const [open, setOpen] = useState(false);
  /** Said by the form after a save, where the pen is looking; the week map it changed is far above. */
  const [saved, setSaved] = useState<string | null>(null);

  const check = (raw: string) => {
    setPreview(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setErrors([`That is not JSON the platform can read: ${(e as Error).message}`]);
      return;
    }
    const result = parseCanvasSeason(parsed);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setPreview({ season: result.season, ignored: result.ignored });
  };

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const refused = seasonFileRefusal(file);
    if (refused) {
      setPreview(null);
      setErrors([refused]);
      return;
    }
    const raw = await file.text();
    setText(raw);
    check(raw);
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    const refused = await onSave(preview.season);
    setBusy(false);
    if (refused) {
      setErrors([refused]);
      return;
    }
    setSaved(`Saved ${preview.season.name}. The week map above reads it now.`);
    setPreview(null);
    setText("");
    setOpen(false);
  };

  const first = preview?.season.weeks[0];
  const last = preview ? preview.season.weeks[preview.season.weeks.length - 1] : undefined;

  return (
    <div className="border-t border-stone-100 pt-3 space-y-2">
      <details
        open={open}
        onToggle={(e) => {
          const nowOpen = e.currentTarget.open;
          setOpen(nowOpen);
          if (nowOpen) setSaved(null);
        }}
      >
        <summary className="cursor-pointer text-sm font-medium text-teal-deep">
          {hasSeason ? "Load a different season file" : "Load a season file"}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-stone-600">
            Paste the season file, or choose it from this device. It is checked here first, and nothing is saved until
            you save it.
          </p>
          <p className="text-xs text-stone-600">
            A season file comes from whoever runs your season, or you can write your own. The format, and a template to
            copy, are in the platform's source under docs/seasons.
          </p>
          <label className="block text-sm font-medium text-stone-900">
            Season file
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
                setErrors([]);
              }}
              rows={6}
              spellCheck={false}
              placeholder='{ "id": "...", "name": "...", "timezone": "...", "weeks": [ ... ] }'
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-stone-900">
              Choose a .json file
              <input
                type="file"
                accept=".json,application/json"
                onChange={choose}
                className="mt-1 block text-sm text-stone-700"
              />
            </label>
            <button
              type="button"
              onClick={() => check(text)}
              disabled={!text.trim()}
              className="text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep hover:bg-stone-50 disabled:opacity-40"
            >
              Check the file
            </button>
          </div>

          {errors[0] && (
            <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">
              <p className="font-medium">This file cannot be loaded as it is:</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {preview && first && last && (
            <div data-testid="season-preview" className="rounded-lg border border-stone-200 p-4 space-y-2">
              <p className="text-sm text-stone-900">
                <span className="font-semibold">{preview.season.name}</span>, from {seasonDateLabel(first.date, true)} to{" "}
                {seasonDateLabel(last.date, true)}, in {preview.season.timezone} time.
              </p>
              {preview.ignored[0] && (
                <p className="text-xs text-stone-600">
                  This release does not keep these fields, so they are left out: {preview.ignored.join(", ")}.
                </p>
              )}
              <ol className="text-xs text-stone-700 space-y-0.5">
                {preview.season.weeks.map((w) => (
                  <li key={w.number}>
                    Week {w.number}, {seasonDateLabel(w.date)}: {w.title}
                    {w.blocks[0] && <span className="text-stone-600"> ({w.blocks.map((b) => CANVAS_BLOCKS[b].name).join(", ")})</span>}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="text-sm font-semibold rounded-lg px-4 py-2 bg-teal-deep text-white disabled:opacity-40"
              >
                Save this season
              </button>
            </div>
          )}
        </div>
      </details>
      {/* Always in the page, and filled on a save: a screen reader announces a
          live region that changes, and may say nothing of one that arrives
          already holding its text. Hidden while empty. */}
      <p role="status" className="text-sm text-stone-900 empty:hidden">
        {saved}
      </p>
    </div>
  );
}

/** The stored season as a file, the same shape the form takes back, so the pen can keep a copy. */
function seasonFileHref(season: CanvasSeason): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(`${JSON.stringify(season, null, 2)}\n`)}`;
}

export function CanvasSeason({
  payload,
  failed,
  now,
  onSave,
  onRemove,
  onRetry,
}: {
  payload: CanvasSeasonPayload | null;
  failed: string | null;
  /** Reads the season again. Handed only when asking again could help: a refusal gets the same answer. */
  onRetry?: () => void;
  now: Date;
  /** Resolves to null when the season was stored, or to the sentence that refused it. */
  onSave: (season: CanvasSeason) => Promise<string | null>;
  /** Resolves to null when the season was taken off, or to the sentence that refused it. */
  onRemove: () => Promise<string | null>;
}) {
  const [removeRefused, setRemoveRefused] = useState<string | null>(null);
  const season = payload?.season ?? null;
  const moment = season ? seasonMoment(season, now) : null;
  /** The day it was loaded, in the season's own timezone. */
  const savedAt = payload?.savedAt ? new Date(payload.savedAt) : null;
  const savedOn =
    season && savedAt && !Number.isNaN(savedAt.getTime()) ? seasonDateLabel(todayIn(season.timezone, savedAt), true) : null;

  const fileHref = useMemo(() => (season ? seasonFileHref(season) : null), [season]);
  /** A season document is stored, one that reads or one that no longer does. Either way the pen may take it off. */
  const stored = !!season || !!payload?.problem;

  const remove = async () => {
    const question = season
      ? "Take this season off? The canvas goes back to canvas order, and every reading stays. The season itself is removed: to load it again you will need its file."
      : "Take the stored season off? It no longer reads, so the canvas is already in canvas order, and every reading stays.";
    if (!window.confirm(question)) return;
    setRemoveRefused(await onRemove());
  };

  return (
    <section data-testid="canvas-season" className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
      <header>
        <h2 className="font-display text-xl font-semibold text-stone-900 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-teal-deep" /> The season
        </h2>
        {season ? (
          <>
            <p className="text-sm text-stone-900 mt-1">
              <span className="font-semibold">{season.name}</span>
              {season.sessionTime ? `, sessions at ${season.sessionTime}` : ""}, {season.timezone} time.
            </p>
            {season.description && <p className="text-sm text-stone-700 mt-1 max-w-2xl">{season.description}</p>}
            {savedOn && (
              <p className="text-xs text-stone-600 mt-1">
                {payload?.savedBy ? `Loaded by ${payload.savedBy.name} on ${savedOn}.` : `Loaded on ${savedOn}.`}
              </p>
            )}
          </>
        ) : payload && !payload.problem ? (
          <p className="text-sm text-stone-700 mt-1 max-w-2xl">
            No season is loaded, so the blocks below are in canvas order. A season file names the blocks each week
            works on and puts them first. It never closes a block: every block stays open every week.
          </p>
        ) : !payload && !failed ? (
          // Nothing is known yet, so nothing is claimed: "no season" would be
          // false in every village that has one, for as long as the read takes.
          <p className="text-sm text-stone-600 mt-1">Reading the season.</p>
        ) : null}
      </header>

      {failed && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3 space-y-2">
          <p>{failed}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep bg-white hover:bg-stone-50"
            >
              Try again
            </button>
          )}
        </div>
      )}
      {payload?.problem && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">
          {payload.problem}{" "}
          {payload.mayEdit
            ? "The blocks below are in canvas order. Take the stored season off below, or load a season file in its place."
            : "The blocks below are in canvas order until a season is loaded again."}
        </p>
      )}

      {season && moment && (
        <>
          <p className="text-sm text-stone-900" data-testid="season-moment">
            {momentLine(moment, season)}
          </p>
          <WeekMap season={season} moment={moment} />
        </>
      )}

      {payload?.mayEdit && (
        <>
          <LoadSeasonForm onSave={onSave} hasSeason={!!season} />
          {stored && (
            <div className="border-t border-stone-100 pt-3 flex flex-wrap items-center gap-3">
              {season && fileHref && (
                <a
                  href={fileHref}
                  download={`${season.id}.json`}
                  className="text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep hover:bg-stone-50"
                >
                  Download this season file
                </a>
              )}
              <button
                type="button"
                onClick={remove}
                className="text-sm font-medium rounded-lg px-3 py-1.5 text-stone-700 border border-stone-300 hover:bg-stone-50"
              >
                Take the season off
              </button>
              {removeRefused && (
                <p role="alert" className="mt-2 text-sm text-red-700">
                  {removeRefused}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
