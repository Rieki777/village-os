/**
 * THE CIRCLE YOU ARE IN, AS A PEEK, on a phone.
 *
 * Stepping into a circle on a phone used to open the whole circle card as a
 * sheet over the map. Measured live at 390x844 it began at 169px and ran to the
 * bottom of the screen, so the one thing a step-in is FOR, seeing what the
 * circle holds, was hidden by the step itself. Rye's ruling, 2026-09-21: "peek,
 * expand on tap". The map stays in view; this bar names where you are and
 * holds the two ways on from here.
 *
 * - The arrow steps back out, one level, to whatever holds this circle.
 * - Tapping the bar, or swiping it up, opens the full card (`SeatSheet`).
 *
 * WHERE IT SITS. Sticky, docked above the tab bar, and the LAST thing in the
 * map's section. Fixed would have covered the end of the page for as long as a
 * circle was open, footer included; sticky rides the bottom of the screen while
 * the reader is anywhere in the map and then settles into the page above the
 * footer, taking its own room. `data-circle-peek` is also what lifts the
 * floating shortcuts button clear of it (index.css), because the button's
 * corner is this bar's right-hand end. Both read one height,
 * `--circle-peek-h`, so the lift cannot drift from the bar it clears.
 */
import { useRef } from "react";
import { ArrowLeft, ChevronUp } from "lucide-react";
import { cssColourForCircle } from "@shared/circleView";
import type { PowerCircle, PowerData } from "./types";

/** How far up a swipe travels, in px, before it counts as asking for the card. */
export const PEEK_SWIPE_PX = 24;

/** One line of counts: what is inside, then how many seats are held. */
export function peekSummary(circle: PowerCircle, data: PowerData): string {
  const seats = data.roles.filter((r) => r.circleId === circle.id);
  const held = seats.reduce((n, s) => n + s.holderCount, 0);
  const places = seats.reduce((n, s) => n + s.seats, 0);
  const inside = data.circles.filter((c) => c.parentCircleId === circle.id).length;
  const seatLine = places > 0 ? `${held} of ${places} seat${places === 1 ? "" : "s"} held` : "no seats yet";
  if (inside === 0) return seatLine.charAt(0).toUpperCase() + seatLine.slice(1);
  return `${inside} circle${inside === 1 ? "" : "s"} inside · ${seatLine}`;
}

export default function CirclePeek({
  circle,
  data,
  outTo,
  onOut,
  onExpand,
}: {
  circle: PowerCircle;
  data: PowerData;
  /** Where the arrow leads, in words: the parent circle's name, or "the village". */
  outTo: string;
  onOut: () => void;
  onExpand: () => void;
}) {
  // Where a swipe began. Null when no swipe is under way, and never set by a
  // touch that starts on the arrow, so a thumb dragging off it cannot open the
  // card on its way to stepping out.
  const swipeFrom = useRef<number | null>(null);

  return (
    <div
      data-circle-peek
      role="region"
      aria-label="The circle you are in"
      className="md:hidden sticky bottom-[var(--tabbar-h)] z-[52] -mx-4 min-h-[var(--circle-peek-h)] flex flex-col justify-end px-2 pt-2 pb-2 touch-none"
      onPointerDown={(e) => {
        swipeFrom.current = (e.target as Element).closest("[data-peek-out]") ? null : e.clientY;
      }}
      onPointerMove={(e) => {
        if (swipeFrom.current !== null && swipeFrom.current - e.clientY > PEEK_SWIPE_PX) {
          swipeFrom.current = null;
          onExpand();
        }
      }}
      onPointerUp={() => {
        swipeFrom.current = null;
      }}
      onPointerCancel={() => {
        swipeFrom.current = null;
      }}
    >
      <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-lg">
        {/* The handle says "this pulls up" before anyone reads a word. */}
        <div aria-hidden="true" className="mx-auto mt-1.5 h-1 w-9 rounded-full bg-muted-foreground/40" />
        <div className="flex items-center gap-1 px-1 pb-1">
          <button
            type="button"
            data-peek-out
            onClick={onOut}
            aria-label={`Step out to ${outTo}`}
            className="shrink-0 w-11 h-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-peek-expand
            onClick={onExpand}
            aria-haspopup="dialog"
            className="flex-1 min-w-0 min-h-[44px] flex items-center gap-2.5 rounded-xl pr-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="shrink-0 w-3 h-3 rounded-full"
              style={{ background: cssColourForCircle({ id: circle.id, color: circle.color ?? null }) }}
            />
            <span className="flex-1 min-w-0">
              <span className="block truncate font-display text-[15px] font-semibold text-foreground">{circle.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{peekSummary(circle, data)}</span>
            </span>
            <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-semibold text-foreground">
              Details
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
