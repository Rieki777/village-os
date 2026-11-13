/**
 * QUIETLOADING: what a page looks like while it arrives (Phase B, lane B3).
 *
 * The route fallback in App.tsx was the last spinning ring on a page-sized
 * wait. This is the breathing leaf with a few words under it, held at the
 * height of a page so the footer does not jump up and back down as the chunk
 * lands. The leaf carries its own colours (--nat-leaf), so it reads on the
 * night world and on the few pages still on the light ground.
 *
 * Phone and desktop, each at its best. A phone shows the leaf and the words,
 * one thing. A desktop has the width to say where things will be, so from
 * `lg` up the page's shape appears under the leaf: an eyebrow, a title and a
 * panel, STILL. Never a running shimmer: a shimmer is a loop beside where
 * words will be (design rule 10), and a still shape says the same thing.
 *
 * THE NIGHT WORLD. With `world`, the wait stands on the sheet's night ground
 * (look.ts WORLD), the ground nearly every member page now arrives on, so a
 * page does not flash light and then go dark as it lands. The route fallback
 * uses it; a wait inside a page that already stands in the world leaves it off.
 *
 * Kept in the shell on purpose: it is a few hundred bytes and only imports
 * the leaf and the look's class strings, never the nature kit.
 */
import { WORLD } from "@/components/journey/look";
import BreathingLoader from "./BreathingLoader";

export interface QuietLoadingProps {
  /** What a screen reader hears and the line under the leaf says. */
  label?: string;
  /** Show the still page shape on a desktop. */
  shape?: boolean;
  /** Stand on the night ground, for a wait that fills the whole page. */
  world?: boolean;
  className?: string;
}

export default function QuietLoading({ label = "Loading page", shape = true, world = false, className = "" }: QuietLoadingProps) {
  return (
    <div
      className={`${world ? `${WORLD} ` : ""}flex min-h-[60vh] flex-col items-center justify-center gap-8 px-4 ${className}`.trim()}
      data-quiet="loading"
    >
      <BreathingLoader label={label} size={56} showLabel />
      {shape ? (
        <div aria-hidden="true" className="hidden w-full max-w-3xl flex-col gap-3 lg:flex" data-quiet="shape">
          <div className="h-3 w-32 rounded-full bg-muted" />
          <div className="h-7 w-2/3 rounded-lg bg-muted" />
          <div className="h-32 w-full rounded-2xl border border-border bg-card" />
        </div>
      ) : null}
    </div>
  );
}
