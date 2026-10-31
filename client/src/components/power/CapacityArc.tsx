/**
 * A circle's border as a meter of its roles, drawn (Rye, 2026-10-23: "arc far,
 * glyphs close"). The geometry is `shared/capacityArc.ts`; this file only
 * paints it, in screen pixels so the meter reads the same at every zoom.
 *
 * Held openings draw solid in the circle's own tone, open ones thinner in
 * amber, a holder whose term has run out in the tone but dashed, and a role
 * still forming as a faint dotted run. A faint track under the whole span keeps
 * the meter's length visible when most of it is empty. The top of the circle
 * stays clear for its name. Decorative: the circle's own label carries the
 * counts for a screen reader.
 */
import { ARC_END, ARC_START, capacityArc, type ArcKind } from "@shared/capacityArc";
import type { PowerSeat } from "./types";

/** An SVG arc path, clockwise from a0 to a1 (radians, screen space). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const at = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M ${at(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1)}`;
}

/** How thick a held segment is on screen. */
export const ARC_SCREEN_PX = 5;

/** The arc's segments for a circle's roles, with gaps sized in screen pixels. */
export function arcFor(roles: PowerSeat[], r: number, pxPerWorld: number) {
  return capacityArc(
    roles.map((s) => ({ id: s.id, seats: s.seats, holderCount: s.holderCount, state: s.state ?? null })),
    pxPerWorld > 0 ? r * pxPerWorld : r,
  );
}

function strokeFor(kind: ArcKind, tone: string, w: number) {
  switch (kind) {
    case "held":
      return { stroke: tone, strokeWidth: w };
    case "expired":
      return { stroke: tone, strokeWidth: w, strokeDasharray: `${w} ${w * 0.8}` };
    case "open":
      return { stroke: "var(--color-amber)", strokeWidth: w * 0.55 };
    case "forming":
      return { stroke: "var(--foreground)", strokeOpacity: 0.5, strokeWidth: w * 0.4, strokeDasharray: `${w * 0.35} ${w * 0.9}` };
  }
}

export default function CapacityArc({
  cx,
  cy,
  r,
  roles,
  tone,
  pxPerWorld,
}: {
  cx: number;
  cy: number;
  r: number;
  /** This circle's own roles. */
  roles: PowerSeat[];
  tone: string;
  pxPerWorld: number;
}) {
  if (!roles.length) return null;
  const unit = pxPerWorld > 0 ? 1 / pxPerWorld : 1;
  // Never thicker than a tenth of the circle, so a small circle keeps its disc.
  const w = Math.min(ARC_SCREEN_PX * unit, r * 0.1);
  return (
    <g aria-hidden="true" pointerEvents="none" data-capacity-arc>
      <path d={arcPath(cx, cy, r, ARC_START, ARC_END)} fill="none" stroke={tone} strokeOpacity={0.2} strokeWidth={w} />
      {arcFor(roles, r, pxPerWorld).map((s, i) => (
        <path key={i} d={arcPath(cx, cy, r, s.a0, s.a1)} fill="none" data-arc-kind={s.kind} {...strokeFor(s.kind, tone, w)} />
      ))}
    </g>
  );
}
