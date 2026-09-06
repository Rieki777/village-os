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
 * ── PAST THE FLOOR, THE ROW FILLS AGAIN IN A NEW COLOUR ──────────────────
 *
 * Sending to more people than the count is allowed and always was: the ceiling
 * bounds the amount one person may receive, never the number of sends. So the
 * row does not grow a tail. It REFILLS: at eight people the row is one heart
 * of the next colour over six of the last, and it fills across again from
 * there. The same seven slots, painted a second time.
 *
 * That shape is honest about what a wider circle actually is. A tail would
 * read as more gratitude given, and there is no more: it is one allowance,
 * spread thinner every time the row starts over. The colour says "again",
 * never "more", and the caption says which time around this is.
 *
 * Three tones and then they cycle, which is a deliberate limit. A fourth and
 * fifth colour would be inventing distinctions nobody can name, and the
 * caption carries the count for anyone who has gone round more than three
 * times. Every tone is a token this palette already defines and already
 * measures, so none of them is a new colour on the night ground.
 */
import type { ReactElement } from "react";

/** lucide-react's `heart` path, inlined: this draws dozens at a time. */
const HEART_D =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";

/**
 * The lap colours, in order. Keyed by position and read modulo its own length
 * so a member on their ninth time around gets a colour and never a blank.
 */
const LAP_CLASS = [
  "fill-notice stroke-notice",       // earned gold
  "fill-open stroke-open",           // living green
  "fill-foreground stroke-foreground", // moonlight
] as const;

const OPEN_CLASS = "fill-none stroke-border";

const lapClass = (lap: number): string =>
  LAP_CLASS[((lap % LAP_CLASS.length) + LAP_CLASS.length) % LAP_CLASS.length] ?? LAP_CLASS[0];

/** "the second time around", for a caption and for a screen reader. */
const ORDINALS = ["", "second", "third", "fourth", "fifth"] as const;
const timesAround = (lap: number): string =>
  ORDINALS[lap] ?? `${lap + 1}th`;

function Heart({ cls }: { cls: string }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={1.6} className={`h-7 w-7 shrink-0 ${cls}`} aria-hidden="true">
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

  // How many complete times round, and how far into the current one. At
  // exactly `fullSends` this is lap 1 with nothing in it yet, which draws as a
  // full row of the FIRST colour and is right: the lap is finished, and the
  // next one has not been started.
  const lap = Math.floor(people / fullSends);
  const filled = people % fullSends;
  // What the slots behind the filling edge show: open on the first time round,
  // and the previous lap's colour on every one after, because those hearts
  // were genuinely earned and the row is being repainted over them.
  const behindClass = lap === 0 ? OPEN_CLASS : lapClass(lap - 1);

  return (
    <div className="mb-5">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="img"
        aria-label={
          `${people} ${people === 1 ? "person" : "people"} thanked this cycle. ` +
          `${fullSends} is the fewest that can take your whole allowance, at up to ${cap} each.` +
          (lap > 0 ? ` This is the ${timesAround(lap)} time round the row.` : "")
        }
      >
        {Array.from({ length: filled }, (_, i) => <Heart key={`f${i}`} cls={lapClass(lap)} />)}
        {Array.from({ length: fullSends - filled }, (_, i) => <Heart key={`b${i}`} cls={behindClass} />)}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {lap > 0
          ? `The ${timesAround(lap)} time round: you have thanked more than ${fullSends} people this cycle. The row fills again, and each gift gets smaller as the circle widens.`
          : `One heart, one person. An open heart is allowance you still hold, and leaving it open at the turn of the cycle costs you nothing.`}
      </p>
    </div>
  );
}
