/**
 * THE REVEAL: the moment a member's two lines appear.
 *
 * Rye, 2026-10-23: "do the animation but not the voice". The six lines of a
 * hexagram draw in from the bottom, the way lines are read; the member's two
 * light up in the sheet's gold (the first solid, the second as a ring, the
 * same marks the circle view uses); then their profile and its two words
 * arrive. About a second and a half, once, on the result step.
 *
 * With reduced motion asked for, the finished state is drawn at once: the
 * moment is the result, never the movement. The glyph is decoration for
 * assistive tech; the heading carries the words.
 */
import { m } from "framer-motion";
import type { GeneKeysView } from "@shared/geneKeys";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { HINT } from "./ui";

export default function GeneKeysReveal({ view, chosen, headingId }: { view: GeneKeysView; chosen: boolean; headingId: string }) {
  const still = useReducedMotion();
  const [first, second] = view.lines;
  const lines = [1, 2, 3, 4, 5, 6];

  return (
    <div className="flex items-center gap-5">
      <div aria-hidden="true" className="flex w-16 shrink-0 flex-col-reverse gap-1.5">
        {lines.map((n, i) => {
          const lit = n === first ? "solid" : n === second ? "ring" : null;
          return (
            <m.span
              key={n}
              className="block h-2.5 rounded-sm"
              initial={still ? false : { scaleX: 0, opacity: 0.2 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: still ? 0 : i * 0.12, duration: still ? 0 : 0.35, ease: "easeOut" }}
              style={{ transformOrigin: "left center" }}
            >
              <m.span
                className={`block h-full w-full rounded-sm ${
                  lit === "solid" ? "bg-notice" : lit === "ring" ? "border-2 border-notice" : "bg-muted-foreground/40"
                }`}
                initial={still || !lit ? false : { opacity: 0.35 }}
                animate={{ opacity: 1 }}
                transition={{ delay: still ? 0 : 0.85, duration: still ? 0 : 0.4 }}
              />
            </m.span>
          );
        })}
      </div>
      <m.div
        className="flex flex-col gap-1"
        initial={still ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: still ? 0 : 1.15, duration: still ? 0 : 0.45, ease: "easeOut" }}
      >
        <span className="font-display text-2xl text-notice">{view.profile}</span>
        <h1 id={headingId} tabIndex={-1} className="font-display text-4xl focus:outline-none">
          {view.names}
        </h1>
        <p className={HINT}>{chosen ? "Chosen by you" : "Your Gene Keys profile"}</p>
      </m.div>
    </div>
  );
}
