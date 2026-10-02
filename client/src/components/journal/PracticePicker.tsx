/**
 * Where a sitting starts: how deep today, and which practice.
 *
 * The time of day suggests one (morning before noon, evening from six) and
 * the suggestion only moves it to the top with a word beside it. Every
 * practice stays one tap away.
 */
import {
  JOURNAL_PRACTICES,
  JOURNAL_PRACTICE_DEFS,
  PULSE_METRICS,
  fillVillage,
  questionsFor,
  type JournalDepth,
  type JournalPractice,
} from "@shared/journal";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, HINT } from "./ui";

const DEPTH_TEXT: Record<JournalDepth, { label: string; line: string }> = {
  light: { label: "Light", line: "A few questions, about two minutes." },
  deep: { label: "Deep", line: "Every question, when you have the time." },
};

function countLine(practice: JournalPractice, depth: JournalDepth): string {
  const questions = questionsFor(practice, depth).length;
  const q = `${questions} ${questions === 1 ? "question" : "questions"}`;
  return practice === "pulse" ? `${PULSE_METRICS.length} quick numbers and ${q}` : q;
}

export default function PracticePicker({
  depth,
  onDepth,
  suggested,
  village,
  onStart,
  resumable,
  onResume,
  onDiscard,
}: {
  depth: JournalDepth;
  onDepth: (d: JournalDepth) => void;
  suggested: JournalPractice | null;
  village: string;
  onStart: (p: JournalPractice) => void;
  /** The practice of a sitting left open on this device, if there is one. */
  resumable: JournalPractice | null;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const order = suggested ? [suggested, ...JOURNAL_PRACTICES.filter((p) => p !== suggested)] : [...JOURNAL_PRACTICES];

  return (
    <div className="space-y-6">
      {resumable && (
        <div className={`${CARD} border-teal-deep/40`} role="region" aria-label="An unfinished page">
          <p className="font-semibold text-foreground">
            You have an unfinished {JOURNAL_PRACTICE_DEFS[resumable].label.toLowerCase()} page on this device.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={BTN_PRIMARY} onClick={onResume}>
              Pick it up
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={onDiscard}>
              Start fresh
            </button>
          </div>
        </div>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-foreground">How deep today?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(DEPTH_TEXT) as JournalDepth[]).map((d) => (
            <label
              key={d}
              className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border px-4 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-deep ${
                depth === d ? "border-teal-deep bg-teal-deep/5" : "border-border bg-card"
              }`}
            >
              <input
                type="radio"
                name="journal-depth"
                value={d}
                checked={depth === d}
                onChange={() => onDepth(d)}
                className="sr-only"
              />
              <span className="font-semibold text-foreground">{DEPTH_TEXT[d].label}</span>
              <span className="text-xs text-muted-foreground">{DEPTH_TEXT[d].line}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Choose a practice</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {order.map((p) => {
            const def = JOURNAL_PRACTICE_DEFS[p];
            return (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => onStart(p)}
                  className="flex h-full min-h-11 w-full flex-col items-start rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-teal-deep hover:bg-teal-deep/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
                >
                  <span className="flex w-full flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold text-foreground">{def.label}</span>
                    {p === suggested && (
                      <span className="rounded-full bg-sage-light px-2 py-0.5 text-xs font-semibold text-sage">
                        Suggested now
                      </span>
                    )}
                  </span>
                  <span className="mt-1 text-sm text-muted-foreground">{fillVillage(def.blurb, village)}</span>
                  <span className="mt-2 text-xs font-medium text-muted-foreground">
                    {def.rhythm}, {countLine(p, depth)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className={`${HINT} mt-3`}>Your words here are yours. Nobody else can read them, an admin included.</p>
      </div>
    </div>
  );
}
