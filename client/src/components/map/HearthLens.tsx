/**
 * THE HEARTHS (Phase D, D2): the circles map's living layer, drawn INSIDE the
 * power map's SVG through its `lenses` seam, the way the decide and resources
 * lenses draw, so PowerMap itself is untouched.
 *
 * Three things, back to front:
 *
 *  1. Mycelial threads between circles the village linked, and between
 *     neighbours inside one container (hearthGeometry.ts). No count rides a
 *     thread, and none is ordered by how many it has.
 *  2. Every circle glows softly as a hearth. A circle that meets today glows
 *     warmer and carries a thin ember ring.
 *  3. Fireflies where people meet today: the number the server already held
 *     to its floor and cap (shared/mapLight.ts), and only for members who
 *     turned their own light on. A light names nobody; there is nothing here
 *     to hover, focus or read out, and the layer is hidden from assistive tech
 *     because the card beside the map says the same thing in words.
 *
 * Under reduced motion the same lights sit still in the same places.
 */
import { useId, type CSSProperties } from "react";
import type { NestedLayout } from "@shared/mapLayout";
import type { HearthToday } from "@shared/mapLight";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { useRest } from "@/components/journey/nature/useRest";
import { fx } from "@/components/journey/nature/geometry";
import { hearthLights, hearthThreads, threadPath, type Disc } from "./hearthGeometry";
// Its stylesheet rides the main one (index.css), saving a 4 KB block of the dist budget.

export interface HearthLensProps {
  layout: NestedLayout;
  circles: ReadonlyArray<{ id: string; parentCircleId?: string | null }>;
  relations: ReadonlyArray<{ fromKind: string; fromId: string; toKind: string; toId: string }>;
  /** Today's hearths, or null for a visitor or before the read lands: glow and threads only. */
  hearths: readonly HearthToday[] | null;
  /** The phone draws one level at a time: no hearth deeper than the map is drawing. */
  maxDepth?: number;
}

export default function HearthLens({ layout, circles, relations, hearths, maxDepth }: HearthLensProps) {
  const still = useReducedMotion();
  const resting = useRest(!still);
  const gid = `hl-ember-${useId().replace(/:/g, "")}`;

  const shown = layout.circles.filter((c) => (maxDepth === undefined || c.depth <= maxDepth) && !c.band);
  const discs: Disc[] = shown.map((c) => ({ id: c.id, x: c.x, y: c.y, r: c.r }));
  const byId = new Map(discs.map((d) => [d.id, d] as const));
  const parent = new Map(circles.map((c) => [c.id, c.parentCircleId ?? null] as const));
  const threads = hearthThreads(discs, (id) => parent.get(id) ?? null, relations);
  const today = new Map((hearths ?? []).map((h) => [h.circleId, h] as const));

  return (
    <g
      className="hl"
      aria-hidden="true"
      data-hearths
      data-motion={still ? "still" : "live"}
      data-rest={resting ? "true" : "false"}
    >
      <defs>
        <radialGradient id={gid}>
          <stop offset="0" className="hl-ember-stop-0" stopOpacity={0.5} />
          <stop offset="0.5" className="hl-ember-stop-1" stopOpacity={0.16} />
          <stop offset="1" className="hl-ember-stop-1" stopOpacity={0} />
        </radialGradient>
      </defs>

      <g data-threads>
        {threads.map((t) => {
          const a = byId.get(t.a);
          const b = byId.get(t.b);
          const drawn = a && b ? threadPath(a, b) : null;
          if (!drawn) return null;
          const opacity = t.kind === "declared" ? 0.55 : 0.3;
          return (
            <g key={`${t.a}|${t.b}`} data-thread={t.kind} opacity={opacity}>
              <path className="hl-thread" d={drawn.main} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              {drawn.hyphae.map((h, i) => (
                <path key={i} className="hl-thread" d={h} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          );
        })}
      </g>

      {discs.map((d) => {
        const h = today.get(d.id);
        const meets = !!h?.meetsToday;
        const lights = hearthLights(d.x, d.y, d.r, h?.lights ?? 0);
        const dot = Math.min(Math.max(d.r * 0.035, 1.6), 5);
        return (
          <g key={d.id} data-hearth={d.id} data-meets-today={meets ? "true" : "false"} data-lights={lights.length}>
            <circle cx={fx(d.x)} cy={fx(d.y)} r={fx(d.r * 0.62)} fill={`url(#${gid})`} opacity={meets ? 1 : 0.5} />
            {meets && (
              <circle className="hl-ring" cx={fx(d.x)} cy={fx(d.y)} r={fx(d.r * 0.3)} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6} />
            )}
            {lights.map((s, i) => (
              <g
                key={i}
                className="hl-ff"
                data-firefly
                style={
                  {
                    "--hl-drift": `${s.drift}s`,
                    "--hl-pulse": `${s.pulse.toFixed(2)}s`,
                    "--hl-delay": `${s.delay.toFixed(2)}s`,
                    "--hl-dx": `${fx(((i % 3) - 1) * dot * 1.4)}px`,
                    "--hl-dy": `${fx((i % 2 ? -1 : 1) * dot * 1.8)}px`,
                  } as CSSProperties
                }
              >
                <circle className="hl-ff-halo" cx={fx(s.x)} cy={fx(s.y)} r={fx(dot * 3.2)} />
                <circle className="hl-ff-dot" cx={fx(s.x)} cy={fx(s.y)} r={fx(dot)} />
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}
