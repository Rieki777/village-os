/**
 * A short card after a screen: what was saved, and what comes next.
 *
 * The night sheet's own card. The words are the feedback, so a member who
 * sees no motion still gets the moment. Focus moves to the heading from the
 * page, and the card does not animate.
 */
import type { StepDoneCopy } from "@shared/stepDone";

export default function StepDoneCard({ saved, next }: StepDoneCopy) {
  return (
    <section
      aria-labelledby="rp-step-done"
      data-step-done=""
      className="max-w-full rounded-2xl border border-border bg-card px-4 py-3 text-foreground motion-reduce:transition-none"
    >
      <h2 id="rp-step-done" tabIndex={-1} className="break-words text-base font-semibold text-foreground outline-none">
        {saved}
      </h2>
      <p className="mt-1 break-words text-sm text-muted-foreground">{next}</p>
    </section>
  );
}
