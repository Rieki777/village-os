/**
 * A sitting, one question at a time.
 *
 * A large prompt, its hint, a textarea that grows, the voice button, Back
 * and Next, and dots for how far along. The pulse's numbers come first as
 * scales. The last step is the review, where everything is editable and
 * saved. "Ask the guide" sits under every step, with the one sentence that
 * says what asking does.
 */
import { useEffect, useRef, type RefObject } from "react";
import { MessageCircleHeart } from "lucide-react";
import { JOURNAL_ANSWER_MAX, JOURNAL_PRACTICE_DEFS } from "@shared/journal";
import GrowingTextarea from "./GrowingTextarea";
import MetricScale from "./MetricScale";
import ReviewStep from "./ReviewStep";
import type { Sitting, Step } from "./sitting";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT, INPUT } from "./ui";

function DebriefMeta({ sitting, onChange }: { sitting: Sitting; onChange: (s: Sitting) => void }) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor="debrief-call" className="block text-xs font-semibold text-muted-foreground">
          Which call? (optional)
        </label>
        <input
          id="debrief-call"
          type="text"
          value={sitting.call}
          maxLength={200}
          onChange={(e) => onChange({ ...sitting, call: e.target.value })}
          className={`${INPUT} mt-1 min-h-11`}
        />
      </div>
      <fieldset className="shrink-0">
        <legend className="text-xs font-semibold text-muted-foreground">Same call in another village? (optional)</legend>
        <div className="mt-1 flex gap-2">
          {([
            [true, "Yes"],
            [false, "No"],
          ] as const).map(([v, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={sitting.portable === v}
              onClick={() => onChange({ ...sitting, portable: sitting.portable === v ? null : v })}
              className={`min-h-11 min-w-16 rounded-lg border px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${
                sitting.portable === v ? "border-teal-deep bg-teal-deep text-white" : "border-border bg-card text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export default function SittingFlow({
  sitting,
  steps,
  onChange,
  onSave,
  saving,
  canSave,
  onStartOver,
  onOpenGuide,
  guideButtonRef,
}: {
  sitting: Sitting;
  steps: Step[];
  onChange: (s: Sitting) => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  onStartOver: () => void;
  onOpenGuide: () => void;
  guideButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const index = Math.min(Math.max(sitting.step, 0), steps.length - 1);
  const step = steps[index]!;
  const asked = steps.filter((s) => s.kind !== "review");
  const def = JOURNAL_PRACTICE_DEFS[sitting.practice];
  const headingRef = useRef<HTMLDivElement>(null);

  // A new step moves focus to its question, so a screen reader reads it and
  // a keyboard starts there. Skipped on the first render of the sitting.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [index]);

  const go = (to: number) => onChange({ ...sitting, step: Math.min(Math.max(to, 0), steps.length - 1) });
  const setText = (key: string, text: string) => onChange({ ...sitting, texts: { ...sitting.texts, [key]: text } });

  const promptId = `journal-step-${index}`;
  const hintId = `${promptId}-hint`;
  const isLastAsked = index === steps.length - 2;

  // On a phone the shortcuts button sat over Next the moment a step loaded
  // (journal QA, 2026-10-02). A sitting is one focused task, so on a phone
  // the button steps out until it ends (index.css, `data-hides-fab-phone`).
  return (
    <div data-hides-fab-phone>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">
          {def.label}, {sitting.depth === "deep" ? "deep" : "light"}
        </p>
        <button type="button" className={BTN_QUIET} onClick={onStartOver}>
          Choose another practice
        </button>
      </div>

      {sitting.practice === "debrief" && <DebriefMeta sitting={sitting} onChange={onChange} />}

      {step.kind !== "review" && (
        <div className="mb-5 flex items-center gap-3">
          <ol className="flex flex-wrap gap-1.5" aria-hidden="true">
            {asked.map((s, i) => (
              <li
                key={`${s.kind}-${"key" in s ? s.key : i}`}
                className={`h-2.5 w-2.5 rounded-full ${i === index ? "bg-teal-deep" : i < index ? "bg-teal-deep/40" : "bg-border"}`}
              />
            ))}
          </ol>
          <p className="text-sm text-muted-foreground">
            {index + 1} of {asked.length}
          </p>
        </div>
      )}

      <div ref={headingRef} tabIndex={-1} className="outline-none">
        {step.kind === "metric" && (
          <MetricScale
            name={step.key}
            prompt={step.prompt}
            min={step.min}
            max={step.max}
            ends={step.ends}
            value={sitting.scores[step.key]}
            onValue={(v) => onChange({ ...sitting, scores: { ...sitting.scores, [step.key]: v } })}
            headingId={promptId}
          />
        )}

        {step.kind === "question" && (
          <div>
            <h2 id={promptId} className="font-display text-2xl font-bold leading-snug text-foreground md:text-3xl">
              {step.prompt}
            </h2>
            {step.hint && (
              <p id={hintId} className="mt-2 text-base text-muted-foreground">
                {step.hint}
              </p>
            )}
            {step.extra && <p className={`${HINT} mt-2`}>A question the guide offered.</p>}
            <div className="mt-5">
              <GrowingTextarea
                key={step.key}
                aria-labelledby={promptId}
                aria-describedby={step.hint ? hintId : undefined}
                value={sitting.texts[step.key] ?? ""}
                onValue={(t) => setText(step.key, t)}
                minRows={4}
                maxLength={JOURNAL_ANSWER_MAX}
              />
            </div>
          </div>
        )}

        {step.kind === "review" && (
          <ReviewStep
            sitting={sitting}
            steps={steps}
            onText={setText}
            onGoTo={go}
            onReflection={(t) => onChange({ ...sitting, reflection: t })}
            onKeepPrivate={(keepPrivate) => onChange({ ...sitting, keepPrivate })}
            onSave={onSave}
            saving={saving}
            canSave={canSave}
          />
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={BTN_SECONDARY} onClick={() => go(index - 1)} disabled={index === 0}>
          Back
        </button>
        {step.kind !== "review" && (
          <button type="button" className={BTN_PRIMARY} onClick={() => go(index + 1)}>
            {isLastAsked ? "Review" : "Next"}
          </button>
        )}
      </div>

      <div className="mt-8 border-t border-border pt-5">
        <button ref={guideButtonRef} type="button" className={BTN_SECONDARY} onClick={onOpenGuide}>
          <MessageCircleHeart className="h-4 w-4" aria-hidden="true" />
          Ask the guide
        </button>
        <p className={`${HINT} mt-2`}>
          Asking the guide sends what you have written in this entry to the AI model so it can answer. Saving never needs it.
        </p>
      </div>
    </div>
  );
}
