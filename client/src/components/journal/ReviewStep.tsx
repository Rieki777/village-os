/**
 * The last step of a sitting: everything written, editable in place, then
 * Save. Pulse numbers show as a line each with a way back to change them.
 *
 * WHERE IT GOES is said here, beside Save, because this is the moment it is
 * decided. An entry is shared with the village's organisational memory unless
 * the member keeps it private (ruling 2026-10-05). The sentence says "when
 * that is connected" on purpose: until the bridge carries journal entries,
 * nothing has gone anywhere, and the page must not claim otherwise.
 */
import { JOURNAL_ANSWER_MAX, JOURNAL_REFLECTION_MAX } from "@shared/journal";
import GrowingTextarea from "./GrowingTextarea";
import type { Sitting, Step } from "./sitting";
import { BTN_PRIMARY, BTN_QUIET, CARD, HINT, signed } from "./ui";

export default function ReviewStep({
  sitting,
  steps,
  onText,
  onGoTo,
  onReflection,
  onKeepPrivate,
  onSave,
  saving,
  canSave,
}: {
  sitting: Sitting;
  steps: Step[];
  onText: (key: string, text: string) => void;
  onGoTo: (index: number) => void;
  onReflection: (text: string) => void;
  onKeepPrivate: (keepPrivate: boolean) => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl font-bold text-foreground md:text-3xl">Read it back</h2>
      <p className={HINT}>Change anything you like before it is saved. Empty answers are left out.</p>

      <ol className="space-y-4">
        {steps.map((step, i) => {
          if (step.kind === "metric") {
            const v = sitting.scores[step.key];
            return (
              <li key={`m-${step.key}`} className={CARD}>
                <p className="text-sm font-semibold text-foreground">{step.prompt}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-foreground">
                  {typeof v === "number" ? (
                    <span className="text-lg font-bold">{signed(v, step.min < 0)}</span>
                  ) : (
                    <span className="text-muted-foreground">Not answered</span>
                  )}
                  <button type="button" className={BTN_QUIET} onClick={() => onGoTo(i)}>
                    Change
                  </button>
                </p>
              </li>
            );
          }
          if (step.kind !== "question") return null;
          const id = `review-${step.key}`;
          return (
            <li key={`q-${step.key}`} className={CARD}>
              <label htmlFor={id} className="block font-semibold text-foreground">
                {step.prompt}
              </label>
              <div className="mt-2">
                <GrowingTextarea
                  id={id}
                  value={sitting.texts[step.key] ?? ""}
                  onValue={(t) => onText(step.key, t)}
                  minRows={2}
                  maxLength={JOURNAL_ANSWER_MAX}
                />
              </div>
            </li>
          );
        })}
      </ol>

      {sitting.reflection && (
        <div className={`${CARD} border-sage/40`}>
          <label htmlFor="review-reflection" className="block font-semibold text-foreground">
            Your reflection, confirmed as your own words
          </label>
          <div className="mt-2">
            <GrowingTextarea
              id="review-reflection"
              value={sitting.reflection}
              onValue={onReflection}
              minRows={2}
              maxLength={JOURNAL_REFLECTION_MAX}
              mic={false}
            />
          </div>
          <button type="button" className={`${BTN_QUIET} mt-1`} onClick={() => onReflection("")}>
            Leave the reflection out
          </button>
        </div>
      )}

      <div className={CARD}>
        <label className="flex items-start gap-3 font-semibold text-foreground">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-current"
            checked={sitting.keepPrivate === true}
            onChange={(e) => onKeepPrivate(e.target.checked)}
            aria-describedby="review-privacy-hint"
          />
          Keep this entry private
        </label>
        <p id="review-privacy-hint" className={`${HINT} mt-1`}>
          {sitting.keepPrivate === true
            ? "It stays in this village, for you alone."
            : "Unless you keep it private, this entry is shared with the village's organisational memory when that is connected, with member names replaced by code-names. Inside the village it is still yours alone."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_PRIMARY} onClick={onSave} disabled={saving || !canSave}>
          {saving ? "Saving..." : "Save to my journal"}
        </button>
        {!canSave && <p className={HINT}>Write or choose something first, then save.</p>}
      </div>
    </div>
  );
}
