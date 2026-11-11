/**
 * THE SEED OF LIFE, one circle per step walked (nature kit, game feel wave 2).
 *
 * The centre circle is the first step; the six around it close one by one,
 * clockwise from the top. A path longer than seven continues into the
 * nineteen-circle Flower of Life on the same lattice. `walked` circles are
 * closed (gold), the `current` one is drawn in firefly light, the rest wait as
 * dotted outlines.
 *
 * A circle that closes while the page is open draws its stroke once. With
 * `bloom`, a complete seed opens its own six petals, once, inside 1.6s:
 * a bloom, never a burst. Under reduced motion everything is simply there.
 *
 * Phone and desktop: the drawing scales to the field it is given (`size`),
 * larger on a wide screen; with a fine pointer, hovering a circle lifts its
 * edge and its `labels` entry shows as the step's name.
 */
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { circleState, fx, lifeBoundary, lifeCentres, petalPath } from "./geometry";
import Fireflies from "./Fireflies";
import "./nature.css";

export interface SeedOfLifeProps {
  /** How many steps the path has. Seven or fewer draw the seed; up to nineteen, the flower. */
  total: number;
  /** How many are walked. */
  walked: number;
  /** The step being walked now; defaults to the one after the last walked. */
  current?: number;
  /** What a screen reader hears, in the caller's words (for example "Step 4 of 7"). */
  label: string;
  /** Each step's name, shown on hover. */
  labels?: readonly string[];
  /** Open the petals once when every circle is closed. */
  bloom?: boolean;
  /** Circles from this index on draw as the component first appears (a moment that just happened). */
  drawFrom?: number;
  /** Fireflies on the current circle, for an illustration of the next act. */
  glowCurrent?: boolean;
  /** The field: sm sits in a strip, md in a card, lg is an illustration that widens on desktop, fill takes its parent's box. */
  size?: "sm" | "md" | "lg" | "fill";
  className?: string;
}

const SIZES = {
  sm: "size-10",
  md: "size-28 sm:size-32",
  lg: "size-48 sm:size-64 lg:size-80",
  fill: "size-full",
} as const;

export default function SeedOfLife({
  total,
  walked,
  current,
  label,
  labels,
  bloom = false,
  drawFrom,
  glowCurrent = false,
  size = "md",
  className = "",
}: SeedOfLifeProps) {
  const still = useReducedMotion();
  const n = Math.max(1, Math.min(19, Math.floor(total)));
  const done = Math.max(0, Math.min(n, Math.floor(walked)));
  const flower = n > 7;
  const r = flower ? 15 : 22;
  const centres = lifeCentres(n, 50, 50, r);
  const firstSeen = useRef(drawFrom ?? done);
  // Where the batch closing now began: the first render's own start, then the walked count before this change.
  const before = useRef(firstSeen.current);
  const base = done > before.current ? before.current : firstSeen.current;
  useEffect(() => {
    before.current = Math.max(before.current, done);
  }, [done]);
  const complete = done >= n;
  const blooming = bloom && complete;
  const now = complete ? -1 : (current ?? done);
  const nowCentre = now >= 0 && now < n ? centres[now] : null;

  return (
    <span
      className={`nk nk-life relative inline-block shrink-0 ${SIZES[size]} ${className}`.trim()}
      data-motion={still ? "still" : "live"}
      data-walked={done}
      data-total={n}
      data-shape={flower ? "flower" : "seed"}
    >
      <svg viewBox="0 0 100 100" role="img" aria-label={label} className="block size-full overflow-visible">
        <circle cx={50} cy={50} r={lifeBoundary(n, r)} fill="none" className="text-border" stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.8} />
        {centres.map((p, i) => {
          const state = circleState(i, done, now);
          const draws = state === "closed" && i >= firstSeen.current;
          const delay = draws ? Math.max(0, i - base) * 0.25 : 0;
          // The step being walked is drawn in firefly light (the kit's own --nk-firefly), never stark white.
          const tone = state === "closed" ? "text-notice" : state === "current" ? "nk-current" : "text-border";
          return (
            <circle
              key={i}
              cx={fx(p.x)}
              cy={fx(p.y)}
              r={r}
              pathLength={1}
              data-state={state}
              className={`${tone}${draws ? " nk-draw" : ""}`}
              style={draws ? ({ "--nk-delay": `${delay}s` } as CSSProperties) : undefined}
              stroke="currentColor"
              strokeWidth={state === "open" ? 0.9 : 1.5}
              fill={state === "closed" ? "currentColor" : "none"}
              fillOpacity={state === "closed" ? (blooming ? 0.1 : 0.05) : undefined}
            >
              {labels?.[i] ? <title>{labels[i]}</title> : null}
            </circle>
          );
        })}
        {blooming ? (
          <g className="nk-bloom text-notice" data-testid="seed-bloom" fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeWidth={0.8}>
            {Array.from({ length: 6 }, (_, k) => (
              <path
                key={k}
                d={petalPath(50, 50, r)}
                style={{ "--nk-r": `${k * 60}deg`, "--nk-delay": `${(k * 0.08).toFixed(2)}s`, transformOrigin: "50px 50px" } as CSSProperties}
              />
            ))}
          </g>
        ) : null}
      </svg>
      {glowCurrent && nowCentre ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: `${nowCentre.x - r}%`,
            top: `${nowCentre.y - r}%`,
            width: `${2 * r}%`,
            height: `${2 * r}%`,
          }}
        >
          <Fireflies count={6} inner={0.3} reach={1} />
        </span>
      ) : null}
    </span>
  );
}
