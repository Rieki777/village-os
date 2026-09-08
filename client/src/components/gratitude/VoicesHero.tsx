/**
 * THE TOP OF THE WALL: what people said, before anything else.
 *
 * The page this replaced opened with a heading, a tooltip, a clock and a form,
 * and the gratitude itself was a list of 15px quotes below all of it. A wall
 * opens with the writing on it. So this is first, it is set in the display
 * face at reading size, and it carries no number of any kind: no totals, no
 * names, no amounts, no dates. A count beside a piece of gratitude turns a
 * human sentence into a dashboard tile, and the meter that a member genuinely
 * needs in order to play lives in the send panel below, where it belongs.
 *
 * ── EVERY LINE SAYS WHAT IT IS ───────────────────────────────────────────
 *
 * Rule 2 of the standing-examples contract is that a row carries its own
 * label, so no read path can present platform fiction as something a
 * neighbour said. `isExample` comes off the payload and is rendered, always.
 * The mark is quiet on purpose, and quiet is the most it is allowed to be:
 * unmarked is not an option this component has.
 *
 * ── NOTHING IS PARKED AT ZERO OPACITY ────────────────────────────────────
 *
 * The voices breathe, and the breath is a narrow one (0.78 to 1) that starts
 * from a visible resting state. A message hidden until an animation reveals it
 * is a message missing from the first frame, from a screenshot, and from a
 * reader who scrolls fast. Reduced motion gets the same composition standing
 * still, which is the MoonDock precedent: the composition without the motion,
 * never the same animation at one millisecond.
 *
 * ── AN EMPTY ANSWER IS NOT AN EMPTY WALL ─────────────────────────────────
 *
 * `null` means the read has not landed or it failed, and this renders nothing
 * at all rather than claiming the village has said nothing. The same
 * three-state discipline the profile's cards hold: a zero is a claim, and a
 * claim needs a payload behind it.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { useReducedMotion } from "@/components/natural/useReducedMotion";
import type { VoicesAnswer } from "@shared/gratitudeVoices";

/**
 * Size follows position, not importance.
 *
 * The set is composed rather than ranked, and nothing in the payload says one
 * voice matters more than another, so the scale must not imply it does. This
 * varies by INDEX, which is a typographic rhythm and carries no claim about
 * the words. Keyed by the three sizes so a fourth cannot be added silently.
 */
const SIZES = ["text-2xl", "text-xl", "text-lg"] as const;
const sizeAt = (i: number): string => SIZES[i % SIZES.length] ?? SIZES[2];

export default function VoicesHero() {
  const [answer, setAnswer] = useState<VoicesAnswer | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    let alive = true;
    fetch("/api/game/gratitude/voices")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && Array.isArray(d.voices)) setAnswer(d as VoicesAnswer);
      })
      .catch(() => {
        /* the hero simply does not render; the wall below still does */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!answer || answer.voices.length === 0) return null;

  const anyExamples = answer.voices.some((v) => v.isExample);

  return (
    <section aria-labelledby="voices-h" className="mb-14">
      <h1 id="voices-h" className="sr-only">
        What people here have thanked each other for
      </h1>

      <div className="columns-1 gap-x-10 sm:columns-2 [&>*]:break-inside-avoid">
        {answer.voices.map((v, i) => (
          <motion.figure
            key={v.id}
            className="mb-8"
            // Visible at rest, always. The breath is an oscillation around
            // that resting state and never a reveal.
            initial={{ opacity: 1 }}
            animate={reduced ? undefined : { opacity: [1, 0.78, 1] }}
            transition={
              reduced
                ? undefined
                : {
                    duration: 14 + (i % 5) * 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                    // Staggered so the field never pulses as one block, which
                    // reads as a page loading rather than as air moving.
                    delay: (i % 7) * 1.6,
                  }
            }
          >
            <blockquote
              className={`font-display leading-snug text-foreground ${sizeAt(i)}`}
            >
              {v.message}
            </blockquote>
            {/*
              THE MARK IS PART OF THE DESIGN, not an apology for the line.

              It was bare uppercase text sitting under the words, which read as
              a disclaimer somebody had been made to add. Rye asked for a
              beautiful tag, and the honest reason to want one is that this
              label is going to sit under the first writing a founder ever
              reads in their village: it should look like it belongs there.

              So it is a chip, on the same earned gold every notice on this
              surface uses, with a hairline edge and a whisper of a fill. The
              contract is unchanged and the row still carries its own label;
              only the craft moved.
            */}
            {v.isExample && (
              <figcaption className="mt-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-notice/40 bg-notice/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-notice">
                  <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-notice" />
                  Example
                </span>
              </figcaption>
            )}
          </motion.figure>
        ))}
      </div>

      {/*
        The banner sentence, once, under the set. `ExamplesBanner` says this
        for twelve other module pages and it says it well, but it explains a
        LIST a founder is about to edit. The hero is read, so this is one line
        in the hero's own register, and the per-line marks above are what
        actually carry the contract.
      */}
      {anyExamples && (
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          The lines marked as examples ship with every village. They retire for
          good once enough people here have thanked each other, and nothing you
          send is ever mixed in with them.
        </p>
      )}
    </section>
  );
}
