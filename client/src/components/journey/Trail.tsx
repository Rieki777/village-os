/**
 * THE TRAIL: a journey's steps as stepping stones over water (journey kit,
 * game feel lane). Each stone is a real button; the water between them fills
 * up to the stone you stand on, and a stone you have passed grows a leaf.
 *
 * A stone you have reached stays open to go back to; one ahead of you opens
 * only when the page lets it (`reached`). The water is the progressbar a
 * screen reader hears. On a phone the stones keep their names for a screen
 * reader and show only the current step's name under the row, so five steps
 * fit on one line.
 *
 * REDUCE MOTION. `data-motion="still"`: the fill stands at its end state, and
 * no leaf unfurls, it is simply there. The CSS answers the same media query;
 * this attribute is what a test (and a later caller) can read.
 */
import { Check } from "lucide-react";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import Leaf from "./Leaf";

export interface TrailProps {
  labels: readonly string[];
  step: number;
  reached: number;
  onGo: (i: number) => void;
  barLabel: string;
  className?: string;
}

export function trailFill(step: number, count: number): number {
  if (count <= 1) return 1;
  return Math.max(0, Math.min(1, step / (count - 1)));
}

export default function Trail({ labels, step, reached, onGo, barLabel, className = "" }: TrailProps) {
  const still = useReducedMotion();
  const n = labels.length;
  const fill = trailFill(step, n);
  return (
    <div className={`jw-trail ${className}`.trim()} data-motion={still ? "still" : "live"}>
      <div role="progressbar" aria-label={barLabel} aria-valuemin={1} aria-valuemax={n} aria-valuenow={step + 1} className="jw-trail-path">
        <span className="jw-trail-fill" data-fill={fill} style={{ transform: `scaleX(${fill})` }} />
      </div>
      <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {labels.map((label, i) => {
          const state = i < step ? "done" : i === step ? "here" : "ahead";
          return (
            <li key={label} className="flex justify-center">
              <button
                type="button"
                disabled={i > reached}
                aria-current={state === "here" ? "step" : undefined}
                data-state={state}
                onClick={() => onGo(i)}
                className="jw-stone group flex min-h-11 w-full flex-col items-center gap-1.5 rounded-2xl px-1 pb-1 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="jw-stone-face" aria-hidden="true">
                  {state === "done" ? <Check className="size-4" /> : i + 1}
                  {state === "done" && <Leaf size={14} unfurl={!still} className="jw-sprout" />}
                </span>
                <span
                  className={`sr-only text-xs leading-tight sm:not-sr-only sm:text-sm ${state === "here" ? "font-bold text-foreground" : state === "done" ? "font-semibold text-foreground" : "font-semibold text-muted-foreground"}`}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-center text-sm font-bold text-foreground sm:hidden" aria-hidden="true">
        {labels[step]}
      </p>
    </div>
  );
}
