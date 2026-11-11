/**
 * THE LIGHT ON THE BELL (Phase B, B2: fireflies arriving).
 *
 * The nature kit's own `Fireflies`, five of them, held close to the bell so
 * they never reach a neighbour in the bar. They drift and pulse, rest after
 * about twenty seconds without input (the kit's `useRest`), and under reduced
 * motion are a still drawing of the same lights in the same places.
 *
 * `arrival` changes when a notice that waits on you arrives while the page is
 * open. The layer is keyed on it, so the lights fly in once from below and to
 * the left and settle on the bell (bellFireflies.css, 1.6s, the bloom limit).
 * Zero means the light was already there when the page loaded: no flight.
 *
 * Lazy, from the shell: the kit stays out of the first page
 * (components/journey/nature/index.ts).
 */
import { Fireflies } from "@/components/journey/nature";
import "./bellFireflies.css";

export interface BellFirefliesProps {
  arrival: number;
}

export default function BellFireflies({ arrival }: BellFirefliesProps) {
  return (
    <span
      key={arrival}
      aria-hidden="true"
      className="bell-ff absolute inset-0 pointer-events-none"
      data-testid="bell-fireflies"
      data-arrival={arrival > 0 ? "true" : "false"}
    >
      <Fireflies count={5} inner={0.5} reach={1.1} />
    </span>
  );
}
