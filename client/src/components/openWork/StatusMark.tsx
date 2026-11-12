/**
 * A QUEST'S STATUS MARK: a seed (open), a sprout (underway) or a flower (done
 * this moon). Phase C, decision 5: the nature layer on the open work board is
 * this small mark per card and never the layout.
 *
 * `PlantShape` is the drawing as an SVG group standing on its base at (0, 0);
 * `PlantGlyph` is the same drawing in its own small box. The meaning lives in
 * lib/questStatus.ts: the shape only draws a status it is handed. Ink is the
 * sheet's: muted for a seed, the living green for a sprout, gold for a
 * flower's petals. Still: nothing here moves.
 */
import type { QuestStatus } from "@/lib/questStatus";

export function PlantShape({ state, scale = 1 }: { state: QuestStatus; scale?: number }) {
  return (
    <g transform={`scale(${scale})`} data-plant={state} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {state === "seed" && (
        <g className="text-muted-foreground">
          <path d="M-7 2 Q0 -1.5 7 2" stroke="currentColor" strokeWidth={1} opacity={0.7} />
          <ellipse cx={0} cy={-3.5} rx={3.2} ry={4.4} stroke="currentColor" strokeWidth={1.2} />
        </g>
      )}
      {state === "sprout" && (
        <g className="text-open">
          <path d="M-6 2 Q0 -0.5 6 2" stroke="currentColor" strokeWidth={1} opacity={0.6} />
          <path d="M0 2 L0 -10" stroke="currentColor" strokeWidth={1.4} />
          <path d="M0 -6 Q-7 -8 -8.5 -14 Q-2.5 -13 0 -7.5" fill="currentColor" fillOpacity={0.22} stroke="currentColor" strokeWidth={1.1} />
          <path d="M0 -8 Q6 -10.5 7.5 -16 Q2 -15 0 -9.5" fill="currentColor" fillOpacity={0.22} stroke="currentColor" strokeWidth={1.1} />
        </g>
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
export function PlantGlyph({ state, className = "size-6" }: { state: QuestStatus; className?: string }) {
  return (
    <svg viewBox="-13 -27 26 31" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <PlantShape state={state} />
    </svg>
  );
}
