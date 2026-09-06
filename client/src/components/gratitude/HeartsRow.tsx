/**
 * ONE HEART, ONE PERSON.
 *
 * How many people this member has thanked this cycle, against how many it
 * takes to give a whole allowance away. Both numbers come off the budget
 * payload, which the server derives from the same two functions that refuse a
 * send, so the hearts and the ceiling can never disagree.
 *
 * ── THE COUNT IS DERIVED, WHICH IS THE POINT ─────────────────────────────
 *
 * `budget.fullSends` is not a target somebody picked. If no one person may
 * take more than a fraction of an allowance, then giving all of it away takes
 * at least that many people, and `gratitude.full_sends_per_cycle` is that
 * number held directly. A village that moves the dial gets a different row
 * here with no edit to this file, and a village whose allowance is too small
 * to hold the dial's count gets the honest smaller number, because the server
 * floors the ceiling first and counts second.
 *
 * ── A HEART IS A PERSON HERE AND AN AMOUNT EVERYWHERE ELSE ───────────────
 *
 * "Heart" already means two things in this build: `kind: 'heart'` is a tap on
 * a feed post, and `feed.heart_amount` is how much Gratitude one tap carries.
 * So this component is careful never to render a heart as a QUANTITY of
 * anything. A heart is one person. The amounts live on the meter beside it,
 * where they are numbers and are labelled as numbers.
 *
 * ── OPEN HEARTS ARE ALLOWANCE, NOT UNTICKED BOXES ────────────────────────
 *
 * A row of empty slots is a checklist, and a checklist on a gratitude page
 * gets filled by the end of the moon whether or not seven people earned it.
 * That would manufacture thanks, which here is not a matter of taste: an
 * insincere send lands in `gratitude_log`, counts toward `receivedEligible`
 * and moves real value at settlement. So the caption says what an open heart
 * IS, and says plainly that leaving them open costs nothing. Unused allowance
 * does not roll over and it never was value; it is permission to speak.
 *
 * ── PAST THE FLOOR ───────────────────────────────────────────────────────
 *
 * Sending to more people than the count is allowed and always was: the
 * ceiling bounds the amount one person may receive, never the number of sends.
 * Those hearts are drawn in the living green rather than the earned gold,
 * because they are not more gratitude given. They are the same allowance
 * spread wider, and the colour says "wider" instead of "more".
 */
import type { ReactElement } from "react";

/** lucide-react's `heart` path, inlined: this draws dozens at a time. */
const HEART_D =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";

type Tone = "given" | "open" | "beyond";

const TONE_CLASS: Record<Tone, string> = {
  given: "fill-notice stroke-notice",
  open: "fill-none stroke-border",
  beyond: "fill-open stroke-open",
};

function Heart({ tone }: { tone: Tone }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={1.6} className={`h-7 w-7 shrink-0 ${TONE_CLASS[tone]}`} aria-hidden="true">
      <path d={HEART_D} />
    </svg>
  );
}

export default function HeartsRow({
  people,
  fullSends,
  cap,
}: {
  /** Distinct people thanked this cycle. */
  people: number;
  /** How many full-strength gifts the allowance holds. */
  fullSends: number;
  /** The most any one person may receive. */
  cap: number;
}) {
  // An allowance that holds nothing draws nothing. A row of zero hearts with a
  // caption about ceilings is noise on a page whose subject is gratitude.
  if (fullSends <= 0) return null;

  const reached = Math.min(people, fullSends);
  const beyond = Math.max(0, people - fullSends);

  return (
    <div className="mb-5">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="img"
        aria-label={
          `${people} ${people === 1 ? "person" : "people"} thanked this cycle. ` +
          `${fullSends} is the fewest that can take your whole allowance, at up to ${cap} each.`
        }
      >
        {Array.from({ length: reached }, (_, i) => <Heart key={`g${i}`} tone="given" />)}
        {Array.from({ length: fullSends - reached }, (_, i) => <Heart key={`o${i}`} tone="open" />)}
        {beyond > 0 && (
          <>
            <span aria-hidden="true" className="mx-1.5 h-6 w-px bg-border" />
            {Array.from({ length: beyond }, (_, i) => <Heart key={`b${i}`} tone="beyond" />)}
          </>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {beyond > 0
          ? `Past the ${fullSends} it takes to give everything, which is fine. The circle is wider and each gift is smaller.`
          : `One heart, one person. An open heart is allowance you still hold, and leaving it open at the turn of the cycle costs you nothing.`}
      </p>
    </div>
  );
}
