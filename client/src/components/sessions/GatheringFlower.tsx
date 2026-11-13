/**
 * THE GATHERING FLOWER, in the open room (Phase C, the Gathering): the Flower
 * of Life, nineteen circles on one lattice, around the shared breath.
 *
 * The centre circle is the breath itself (SharedBreath draws its seed there).
 * Each person here lights one circle around it, the inner six first, then the
 * outer twelve, clockwise from the top: one circle per arrival, never a name,
 * a number beside a person or an order of who came first. A circle that
 * lights while the room is open draws its stroke once, inside the kit's
 * 1.2s; the circles already lit when the page opens are simply there. More
 * than eighteen people and the flower is whole.
 *
 * Under reduced motion the same flower stands still, lit as it is. The
 * drawing is decoration for the words beside it (`aria-hidden`); the line
 * "Five of us are here" carries the count for a screen reader.
 *
 * Geometry from the nature kit (`flowerOfLifeCentres`, the lattice of
 * equal circles, each centre on its neighbour's edge); motion from the kit's
 * stylesheet, so the glow re-tints with the village's night.
 */
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { flowerOfLifeCentres, fx } from "@/components/journey/nature/geometry";
import "@/components/journey/nature/nature.css";

/** The flower's circles around the centre: the most arrivals it shows one by one. */
export const FLOWER_PLACES = 18;

/** The radius of one circle in the 100-unit field: the whole flower (3r) fills it with a margin. */
export const FLOWER_R = 100 / 6.3;

/** How many of the eighteen circles are lit for this many people here. */
export function litCircles(here: number): number {
  return Math.max(
    0,
    Math.min(FLOWER_PLACES, Math.floor(Number.isFinite(here) ? here : 0))
  );
}

export interface GatheringFlowerProps {
  /** How many people are here now. */
  here: number;
  className?: string;
}

export default function GatheringFlower({
  here,
  className = "",
}: GatheringFlowerProps) {
  const still = useReducedMotion();
  const lit = litCircles(here);
  const r = FLOWER_R;
  const centres = flowerOfLifeCentres(50, 50, r);
  // The circles lit when the page first drew are simply there; later arrivals draw once.
  const firstSeen = useRef(lit);
  const before = useRef(lit);
  const base = lit > before.current ? before.current : firstSeen.current;
  useEffect(() => {
    before.current = Math.max(before.current, lit);
  }, [lit]);

  return (
    <span
      aria-hidden="true"
      className={`nk nk-life block ${className}`.trim()}
      data-motion={still ? "still" : "live"}
      data-lit={lit}
      data-testid="gathering-flower"
    >
      <svg viewBox="0 0 100 100" className="block size-full overflow-visible">
        <circle
          cx={50}
          cy={50}
          r={fx(3 * r)}
          fill="none"
          className="text-border"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={0.6}
        />
        {centres.slice(1).map((p, k) => {
          const i = k + 1;
          const on = i <= lit;
          const draws = on && i > firstSeen.current;
          const delay = draws ? Math.max(0, i - 1 - base) * 0.25 : 0;
          return (
            <circle
              key={i}
              cx={fx(p.x)}
              cy={fx(p.y)}
              r={fx(r)}
              pathLength={1}
              data-state={on ? "closed" : "open"}
              className={`${on ? "text-notice" : "text-border"}${draws ? " nk-draw" : ""}`}
              style={
                draws
                  ? ({ "--nk-delay": `${delay}s` } as CSSProperties)
                  : undefined
              }
              stroke="currentColor"
              strokeWidth={on ? 1.2 : 0.7}
              strokeOpacity={on ? 1 : 0.45}
              fill={on ? "currentColor" : "none"}
              fillOpacity={on ? 0.06 : undefined}
            />
          );
        })}
        <circle
          cx={50}
          cy={50}
          r={fx(r)}
          fill="none"
          className="text-notice"
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth={1}
          data-state="centre"
        />
      </svg>
    </span>
  );
}
