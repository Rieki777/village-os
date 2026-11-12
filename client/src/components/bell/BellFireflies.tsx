/**
 * THE LIGHT ON THE BELL (Phase B, B2: fireflies arriving).
 *
 * The nature kit's own `Fireflies`, five of them, held close to the bell so
 * they never reach a neighbour in the bar. They drift and pulse, rest after
 * about twenty seconds without input (the kit's `useRest`), and under reduced
 * motion are a still drawing of the same lights in the same places.
 *
 * `arrival` changes when a notice that waits on you arrives while the page is
 * open. The lights then fly in once from below and to the left and settle on
 * the bell (1.6s, the bloom limit; transform and opacity only; none at all
 * under reduced motion). Zero means the light was already there when the page
 * loaded: no flight. The flight is the Web Animations API, so the chunk
 * carries no stylesheet of its own: under the block-charged dist budget a
 * 259-byte CSS file costs a whole 4 KB block.
 *
 * Lazy, from the shell: the kit stays out of the first page
 * (components/journey/nature/index.ts).
 */
import { useEffect, useRef } from "react";
import { Fireflies } from "@/components/journey/nature";
import { prefersReducedMotion } from "@/components/natural/useReducedMotion";

const FLIGHT: Keyframe[] = [
  { opacity: 0, transform: "translate(-28px, 22px) scale(0.6)" },
  { opacity: 1, offset: 0.55 },
  { opacity: 1, transform: "none" },
];

export interface BellFirefliesProps {
  arrival: number;
}

export default function BellFireflies({ arrival }: BellFirefliesProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (arrival === 0 || !el || typeof el.animate !== "function" || prefersReducedMotion()) return;
    const flight = el.animate(FLIGHT, { duration: 1600, easing: "cubic-bezier(0.3, 0.6, 0.2, 1)", fill: "both" });
    return () => flight.cancel();
  }, [arrival]);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      data-testid="bell-fireflies"
      data-arrival={arrival > 0 ? "true" : "false"}
    >
      <Fireflies count={5} inner={0.5} reach={1.1} />
    </span>
  );
}
