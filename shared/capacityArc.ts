/**
 * THE CAPACITY ARC: a circle's border as a meter of its roles.
 *
 * From the whole village a role glyph is a few pixels across, so the only fact
 * it carried at that distance was "something is here". The arc says how full a
 * circle is in the same glance as its name: one segment per opening on the
 * circle's own stroke, held ones solid, open ones thin. Stepping into a circle
 * brings the glyphs back, with faces, terms and the link ring (Rye, 2026-10-23:
 * "arc far, glyphs close").
 *
 * The arc runs from 40 to 320 degrees clockwise from twelve o'clock, so the top
 * 80 degrees stay clear for a name drawn there. Pure and deterministic, like
 * the layout it sits beside: same roles in, same segments out.
 */

/** What one opening shows. `expired` is a holder whose term has run out,
 *  which the legend calls "ready to be re-chosen". */
export type ArcKind = "held" | "expired" | "open" | "forming";

export interface ArcRole {
  id: string;
  /** How many people the role holds. Absent or below 1 counts as one opening. */
  seats?: number | null;
  holderCount?: number | null;
  /** The server's seat state: open, partial, filled, forming or expired. */
  state?: string | null;
}

export interface ArcSegment {
  /** The role this opening belongs to; a merged run carries its first role. */
  roleId: string;
  kind: ArcKind;
  /** Screen-space angles in radians (y down, -PI/2 at twelve o'clock), a0 < a1. */
  a0: number;
  a1: number;
  /** How many openings this segment stands for: 1, or more for a merged run. */
  count: number;
}

const DEG = Math.PI / 180;
export const ARC_START = -Math.PI / 2 + 40 * DEG;
export const ARC_END = -Math.PI / 2 + 320 * DEG;
/** Past this many openings each segment would be too short to read as one,
 *  so runs of the same kind merge into one segment each. */
export const ARC_MAX_SEGMENTS = 24;
/** The gap between two segments, in canvas units at the arc's radius. */
const ARC_GAP = 3;

/** Held first, then the ones to re-choose, then the open ones, then the ones
 *  still forming: the meter fills from the start of the arc. */
const KIND_ORDER: Record<ArcKind, number> = { held: 0, expired: 1, open: 2, forming: 3 };

/** One entry per opening, in meter order. */
export function arcOpenings(roles: ArcRole[]): Array<{ roleId: string; kind: ArcKind }> {
  const openings: Array<{ roleId: string; kind: ArcKind }> = [];
  for (const role of roles) {
    const places = Math.max(1, Math.floor(Number(role.seats) || 1));
    const held = Math.min(places, Math.max(0, Math.floor(Number(role.holderCount) || 0)));
    for (let i = 0; i < places; i++) {
      const kind: ArcKind =
        role.state === "forming" ? "forming"
        : i < held ? (role.state === "expired" ? "expired" : "held")
        : "open";
      openings.push({ roleId: role.id, kind });
    }
  }
  // A stable sort keeps the roles' own order inside each kind.
  return openings
    .map((o, i) => ({ o, i }))
    .sort((a, b) => KIND_ORDER[a.o.kind] - KIND_ORDER[b.o.kind] || a.i - b.i)
    .map(({ o }) => o);
}

/**
 * The segments of a circle's capacity arc at radius `r`. No roles, no arc: the
 * renderer draws the plain border. A segment never shrinks below 40% of its
 * slot, so a crowded small circle still reads as a meter.
 */
export function capacityArc(roles: ArcRole[], r: number): ArcSegment[] {
  const openings = arcOpenings(roles);
  if (!openings.length) return [];

  const runs: Array<{ roleId: string; kind: ArcKind; count: number }> = [];
  if (openings.length > ARC_MAX_SEGMENTS) {
    for (const o of openings) {
      const last = runs[runs.length - 1];
      if (last && last.kind === o.kind) last.count += 1;
      else runs.push({ roleId: o.roleId, kind: o.kind, count: 1 });
    }
  } else {
    for (const o of openings) runs.push({ ...o, count: 1 });
  }

  const span = ARC_END - ARC_START;
  const perOpening = span / openings.length;
  const gap = Math.min(r > 0 ? ARC_GAP / r : 0, perOpening * 0.6);
  const segments: ArcSegment[] = [];
  let at = ARC_START;
  for (const run of runs) {
    const slice = perOpening * run.count;
    segments.push({ roleId: run.roleId, kind: run.kind, a0: at + gap / 2, a1: at + slice - gap / 2, count: run.count });
    at += slice;
  }
  return segments;
}

/** "1 of 4 held, 3 open": the counts the arc draws, for the circle's label. */
export function arcCounts(roles: ArcRole[]): { held: number; places: number; open: number } {
  const openings = arcOpenings(roles);
  const held = openings.filter((o) => o.kind === "held" || o.kind === "expired").length;
  const open = openings.filter((o) => o.kind === "open").length;
  return { held, places: openings.length, open };
}
