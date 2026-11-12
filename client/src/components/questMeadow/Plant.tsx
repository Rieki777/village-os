/**
 * A QUEST AS A PLANT: a seed, a bud or a flower (Phase C, decision 5).
 *
 * `PlantShape` is the drawing as an SVG group, standing on its own base at
 * (0, 0) and growing upward, so a bed can place it on its soil. `PlantGlyph`
 * is the same drawing in its own small box, for a card, a row or a legend.
 *
 * The meaning lives in lib/questMeadow.ts: the shape only draws a state it is
 * handed. Ink is the sheet's: muted for a seed, the living green for stems
 * and leaves, gold for a bud's tip and a flower's petals. Nothing loops; the
 * one motion is a hover lift the bed applies, inside reduced-motion's
 * no-preference.
 */
import type { PlantState } from "@/lib/questMeadow";

export function PlantShape({ state, scale = 1 }: { state: PlantState; scale?: number }) {
  return (
    <g transform={`scale(${scale})`} data-plant={state} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {state === "seed" && (
        <g className="text-muted-foreground">
          <path d="M-7 2 Q0 -1.5 7 2" stroke="currentColor" strokeWidth={1} opacity={0.7} />
          <ellipse cx={0} cy={-3.5} rx={3.2} ry={4.4} stroke="currentColor" strokeWidth={1.2} />
        </g>
      )}
      {state === "bud" && (
        <>
          <g className="text-open">
            <path d="M0 2 Q-1 -6 0 -12" stroke="currentColor" strokeWidth={1.4} />
            <path d="M0 -5 Q-6 -6 -7.5 -11" stroke="currentColor" strokeWidth={1.1} />
            <path d="M0 -7 Q5 -8 6.5 -12" stroke="currentColor" strokeWidth={1.1} />
          </g>
          <path
            className="text-notice"
            d="M0 -12 Q-4.5 -16.5 0 -23 Q4.5 -16.5 0 -12Z"
            fill="currentColor"
            fillOpacity={0.22}
            stroke="currentColor"
            strokeWidth={1.2}
          />
        </>
      )}
      {state === "flower" && (
        <>
          <g className="text-open">
            <path d="M0 2 Q1 -7 0 -12" stroke="currentColor" strokeWidth={1.4} />
            <path d="M0 -5 Q6 -6 8 -10" stroke="currentColor" strokeWidth={1.1} />
          </g>
          {/* Five petals on the circle's own symmetry, and the heart in firefly gold. */}
          <g className="text-notice" transform="translate(0 -17)">
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse
                key={a}
                cx={0}
                cy={-5}
                rx={2.8}
                ry={5}
                transform={`rotate(${a})`}
                fill="currentColor"
                fillOpacity={0.3}
                stroke="currentColor"
                strokeWidth={1}
              />
            ))}
            <circle r={2.3} fill="currentColor" />
          </g>
        </>
      )}
    </g>
  );
}

/** One plant in its own small box. Decorative: the words beside it say what it is. */
export function PlantGlyph({ state, className = "size-6" }: { state: PlantState; className?: string }) {
  return (
    <svg viewBox="-13 -27 26 31" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <PlantShape state={state} />
    </svg>
  );
}
