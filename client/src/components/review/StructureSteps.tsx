/**
 * Where ONE structure change stands: accepted into a draft, waiting to publish,
 * live, and then its people carried across from the old chart. It replaces a "How it lands" box that described the three steps in
 * general and never said which one this batch was on, and whose second step
 * promised a withdraw with no button anywhere near it.
 *
 * The current step carries its action inline (`action`), so the next thing to
 * do sits under the sentence that says what it is. A step that is done says
 * so, and a step that is next has no button.
 *
 * Step two also holds the slot for the village vote on a draft (phase B, built
 * separately as an org.decide ballot). It is a sentence and never a button
 * until that path exists: a button that goes nowhere is the defect this page
 * is being rebuilt to remove.
 *
 * Step four, carrying people across, follows a published change: everyone on
 * the old chart moves to a seat on the new one, and the old chart retires once
 * it is empty (components/review/CarryAcross.tsx). `carry` puts the page on it,
 * and `complete` marks it done. A server too old to send the carry list stays
 * on "live", where step four reads as next.
 */
import type { ReactNode } from "react";

export type StructureStage = "review" | "draft" | "live" | "carry";

const ORDER: StructureStage[] = ["review", "draft", "live", "carry"];

const card = "rounded-2xl border border-border bg-card text-card-foreground";

export default function StructureSteps({
  stage,
  source,
  action,
  complete = false,
}: {
  stage: StructureStage;
  /** The carry step is finished: everyone moved and the old chart retired. */
  complete?: boolean;
  /** The source's display name, or a plain stand-in. */
  source: string;
  /** The current step's action, rendered under its sentence. */
  action?: ReactNode;
}) {
  const at = ORDER.indexOf(stage);
  const steps: Array<{ title: string; body: string }> = [
    {
      title: "Accept into a draft",
      body: `One draft holds every change you keep. ${source} can suggest, and only people decide.`,
    },
    {
      title: "Waiting to publish",
      body: "Nothing is live until the draft is published. Until then you can withdraw it, and its proposals go back to the review queue.",
    },
    {
      title: "Live",
      body: "Circles and seats publish together. People keep their seats, and a seat somebody holds is never retired.",
    },
    {
      title: "Carry people across",
      body: "Each person on the old chart gets a seat on the new one, one at a time. The old chart retires once nobody is left in it.",
    },
  ];
  const stateOf = (i: number): "done" | "now" | "next" =>
    i < at || (stage === "live" && i === at) || (stage === "carry" && complete && i === at) ? "done" : i === at ? "now" : "next";
  // Step three reads "Live now" from the moment the change is live, whichever step the page is on.
  const liveNow = (i: number) => i === 2 && at >= 2;
  const WORD = { done: "Done", now: "Now", next: "Next" } as const;

  return (
    <section className="grid gap-2.5" aria-labelledby="h-steps">
      <h2 id="h-steps" className="font-display text-[22px]">Where this change is</h2>
      <ol className={`${card} grid`}>
        {steps.map((s, i) => {
          const state = stateOf(i);
          return (
            <li
              key={s.title}
              data-testid={`step-${i + 1}`}
              data-state={state}
              aria-current={state === "now" || (stage === "live" && i === 2) || (complete && i === at) ? "step" : undefined}
              className={`px-4 py-3.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 ${i ? "border-t border-border" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 w-7 h-7 rounded-full grid place-items-center text-[13px] font-bold border ${
                  state === "done"
                    ? "bg-open text-background border-open"
                    : state === "now"
                      ? "border-notice text-notice"
                      : "border-border text-muted-foreground"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <div className="grid gap-1 min-w-0">
                <p className="flex flex-wrap items-baseline gap-2">
                  <b className={`font-display font-normal text-[17px] ${state === "next" ? "text-muted-foreground" : ""}`}>{s.title}</b>
                  <span
                    className={`text-[11px] font-bold tracking-wide uppercase ${
                      state === "done" ? "text-open" : state === "now" ? "text-notice" : "text-muted-foreground"
                    }`}
                  >
                    {liveNow(i) ? "Live now" : WORD[state]}
                  </span>
                </p>
                <span className="text-[13px] text-muted-foreground">{s.body}</span>
                {i === at && action && <div className="mt-2 grid gap-2">{action}</div>}
                {i === 1 && at <= 1 && (
                  <p
                    className="mt-2 rounded-xl border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground"
                    data-testid="put-to-village-slot"
                  >
                    <b className="text-foreground font-semibold">Put it to the village.</b> A village vote on a draft is on its way.
                    Until it lands, an admin publishes the draft.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
