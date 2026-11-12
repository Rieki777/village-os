/**
 * A PLANT: the state of a piece of work, drawn (Phase D, lane D1; the sitewide
 * grammar's "seed, sprout, bud, flower"). A seed waits for hands, a bud is
 * being carried, a flower has flowered. It describes the work and never sits
 * beside a person.
 *
 * Still: a plant is read, never animated. The flower's five petals sit on the
 * golden angle's pentagon, the same structure as the rest of the kit.
 */
import { fx } from "@/components/journey/nature/geometry";
import type { PlantState } from "./hearthModel";

const PETALS = Array.from({ length: 5 }, (_, k) => {
  const a = ((k * 72 - 90) * Math.PI) / 180;
  return { x: 16 + 5.2 * Math.cos(a), y: 12 + 5.2 * Math.sin(a) };
});

export default function Plant({ state, className = "" }: { state: PlantState; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={`size-8 shrink-0 ${className}`.trim()} data-plant={state}>
      {/* The soil line every plant stands in. */}
      <path d="M5 28 Q16 26.5 27 28" fill="none" stroke="currentColor" strokeWidth={1} className="text-border" />
      {state === "seed" ? (
        <ellipse cx={16} cy={25.5} rx={3.2} ry={2.2} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-muted-foreground" />
      ) : null}
      {state === "bud" ? (
        <g className="text-open" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round">
          <path d="M16 27.5 C16 22 15 18 16 13" />
          <path d="M16 21 C13 20 11.5 18 11.5 16" />
          <path d="M16 6 C19 9 19 12 16 14 C13 12 13 9 16 6 Z" fill="currentColor" fillOpacity={0.2} />
        </g>
      ) : null}
      {state === "flower" ? (
        <g>
          <path d="M16 27.5 C16 22 15.5 19 16 15" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" className="text-open" />
          <g className="text-notice" fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.1}>
            {PETALS.map((p, k) => (
              <circle key={k} cx={fx(p.x)} cy={fx(p.y)} r={3.6} />
            ))}
            <circle cx={16} cy={12} r={2.2} fillOpacity={0.9} />
          </g>
        </g>
      ) : null}
    </svg>
  );
}
