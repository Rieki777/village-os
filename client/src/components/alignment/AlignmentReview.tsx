/**
 * THE EXACT WORDS, AT REVIEW (seat settings PR5, spec section 4.3).
 *
 * "Propose and align" records the candidate's alignment in the same act that
 * writes the application, so the Review step has to show the words that act
 * binds to, exactly. They are rendered by the server
 * (`POST /api/governance/role-applications/words`) with the code that stores
 * them, and handed back on publish as `alignedWords`: if a seat was renamed or
 * the terms moved in between, the server refuses rather than aligning the
 * member with words they did not see.
 *
 * Terms carrying money show the identity re-confirm here when the last one is
 * stale (decision 3), and the publish button waits for it.
 */
import { useEffect, useState } from "react";
import { BreathingLoader } from "@/components/natural";
import { ALIGN_WORDS } from "@shared/alignments";
import { ReconfirmPanel } from "./AlignButton";
import { fetchApplicationWords, fetchConfirmState } from "./alignmentsApi";

export interface ReviewAlignment {
  /** The words shown, to send back as `alignedWords`; null until they are read. */
  words: string | null;
  /** True when the button may be pressed: words read, and money confirmed when it asks. */
  ready: boolean;
}

export const REVIEW_WORDS = {
  heading: "The words you align with",
  lead: "Proposing records that you align with these words, from your own account. Nobody types a name.",
  reading: "Reading the words",
} as const;

export default function AlignmentReview({ body, onState }: { body: Record<string, unknown>; onState: (s: ReviewAlignment) => void }) {
  const [words, setWords] = useState<{ title: string; body: string; money: boolean; intent: string } | null>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<boolean | null>(null);
  const key = JSON.stringify(body);

  useEffect(() => {
    let alive = true;
    setWords(null);
    setError("");
    void fetchApplicationWords(JSON.parse(key)).then((a) => {
      if (!alive) return;
      if (a.ok) setWords(a.data);
      else setError(a.error);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(() => {
    if (!words?.money) {
      setFresh(true);
      return;
    }
    let alive = true;
    void fetchConfirmState().then((a) => {
      if (alive) setFresh(a.ok ? a.data.fresh : false);
    });
    return () => {
      alive = false;
    };
  }, [words?.money]);

  useEffect(() => {
    onState({ words: words?.body ?? null, ready: !!words && fresh === true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, fresh]);

  return (
    <section aria-labelledby="review-align-h" data-alignment-review="" className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <h3 id="review-align-h" className="text-base font-bold text-foreground">
        {REVIEW_WORDS.heading}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{REVIEW_WORDS.lead}</p>
      {!words && !error && (
        <div className="flex justify-center py-6">
          <BreathingLoader label={REVIEW_WORDS.reading} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {words && (
        <>
          <pre
            data-alignment-words=""
            className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-background/40 p-4 font-sans text-sm leading-relaxed text-foreground"
          >
            {words.body}
          </pre>
          <p className="mt-3 text-sm font-medium text-foreground">{words.intent}</p>
          {words.money && fresh === false && <ReconfirmPanel onConfirmed={() => setFresh(true)} />}
          {words.money && fresh === true && <p className="mt-2 text-xs text-muted-foreground">{ALIGN_WORDS.reconfirmed}</p>}
        </>
      )}
    </section>
  );
}
