/**
 * THE FOUR STEPS OF /roles/select, as real buttons over a progress bar.
 *
 * A step you have reached stays open to go back to; one ahead of you opens
 * only through "Next", so nobody lands on Apply with nothing chosen. The bar
 * is a progressbar for a screen reader and a gradient for everyone else.
 */
import { Check } from "lucide-react";

export default function SelectStepper({
  labels,
  step,
  reached,
  onGo,
  barLabel,
}: {
  labels: readonly string[];
  step: number;
  reached: number;
  onGo: (i: number) => void;
  barLabel: string;
}) {
  const pct = Math.round(((step + 1) / labels.length) * 100);
  return (
    <div className="mt-6">
      <div role="progressbar" aria-label={barLabel} aria-valuemin={1} aria-valuemax={labels.length} aria-valuenow={step + 1} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="sel-bar sel-bar-fill h-full rounded-full bg-gradient-to-r from-primary to-notice" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {labels.map((label, i) => {
          const here = i === step;
          const done = i < step;
          const locked = i > reached;
          return (
            <li key={label}>
              <button
                type="button"
                disabled={locked}
                aria-current={here ? "step" : undefined}
                onClick={() => onGo(i)}
                className={`flex min-h-11 w-full items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                  here ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted"
                }`}
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${here ? "bg-notice text-background" : "bg-muted text-foreground"}`} aria-hidden="true">
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span className="min-w-0 break-words leading-tight">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
