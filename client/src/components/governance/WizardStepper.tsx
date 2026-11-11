/**
 * THE STEPPER: where you are in this type's walk, and how to get back.
 *
 * Hypha's `creation-stepper.vue` is a right rail of numbered circles that
 * become checkmarks, with click-back to any completed step, collapsing to a
 * row of dots on mobile (harvest section 1). This is that, with two changes
 * the house rules force and one the walker makes possible:
 *
 *  - CLICK-BACK ONLY. Jumping forward past an unanswered step is how a member
 *    reaches the review screen with three blanks and no idea which. Backward
 *    is always safe, so backward is what is offered.
 *  - THE STEPS ARE THE TYPE'S OWN. It renders `walkFor(type)`, already pruned,
 *    so a rule change shows four circles rather than five with one crossed
 *    out. Nobody has to explain a step that does not apply.
 *  - The list is an ordered list with aria-current on the step you are on, and
 *    every completed circle carries a check that survives greyscale.
 */
import { Check } from "lucide-react";
import type { StepKey } from "./wizardConfig";
import { walkFor } from "./wizardWalk";

export default function WizardStepper({
  typeId,
  answers,
  current,
  onGoBack,
}: {
  typeId: string | null;
  /** The answers so far: a door start walks without the kind step (wizardDoor.ts). */
  answers?: Record<string, unknown>;
  current: StepKey;
  onGoBack: (step: StepKey) => void;
}) {
  const walk = walkFor(typeId, answers);
  const at = Math.max(0, walk.findIndex((s) => s.key === current));

  return (
    <nav aria-label="Steps in this proposal">
      {/* Desktop: the right rail. */}
      <ol className="hidden space-y-1 lg:block">
        {walk.map((step, i) => {
          const done = i < at;
          const here = i === at;
          const body = (
            <>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  done
                    ? "border-notice bg-notice text-background"
                    : here
                      ? "border-notice text-notice"
                      : "border-border text-muted-foreground"
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={here ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground"}>
                {step.label}
              </span>
            </>
          );
          return (
            <li key={step.key}>
              {done ? (
                <button
                  type="button"
                  onClick={() => onGoBack(step.key)}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {body}
                  <span className="sr-only">, completed. Go back to it</span>
                </button>
              ) : (
                <span
                  aria-current={here ? "step" : undefined}
                  className="flex min-h-[44px] items-center gap-3 px-2 text-sm"
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile: one step and a row of dots. */}
      <div className="lg:hidden">
        <p className="text-sm font-semibold text-foreground">
          {walk[at]?.label}
          <span className="ml-2 font-normal text-muted-foreground">
            step {at + 1} of {walk.length}
          </span>
        </p>
        <ol className="mt-2 flex gap-1.5">
          {walk.map((step, i) => (
            <li key={step.key} className="flex-1">
              <span
                aria-current={i === at ? "step" : undefined}
                className={`block h-1.5 rounded-full ${
                  i < at ? "bg-notice" : i === at ? "bg-notice/60" : "bg-muted"
                }`}
              >
                <span className="sr-only">
                  {step.label}
                  {i < at ? ", done" : i === at ? ", you are here" : ", to come"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
