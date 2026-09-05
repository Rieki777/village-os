/**
 * Time on the map (0083, spec 9): a seat whose term ends within 30 days
 * wears a thin amber arc; the season ring around the village names the
 * running season and when it rolls. The clock badge on an expired seat is
 * SeatGlyph's; this file draws only the forward-looking marks.
 */
import { arcPath } from "./SeatGlyph";
import { daysUntil, termEndingSoon } from "./types";

export function TermArc({ x, y, r, termEnds }: { x: number; y: number; r: number; termEnds: string | null | undefined }) {
  if (!termEndingSoon(termEnds)) return null;
  const days = daysUntil(termEnds) ?? 0;
  // The arc grows as the date nears: 30 days out a sliver, on the day a
  // near-full ring. Time made visible without a single word.
  const sweep = 0.25 + ((30 - days) / 30) * 0.65;
  return (
    <path
      d={arcPath(x, y, r + 3.5, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * sweep)}
      fill="none"
      stroke="var(--color-amber)"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <title>term ends in {days} day{days === 1 ? "" : "s"}</title>
    </path>
  );
}

/** The smallest the season line may render, in SCREEN pixels. */
const MIN_SEASON_PX = 11;

export function SeasonRing({
  cx,
  cy,
  r,
  season,
  pxPerWorld = 0,
}: {
  cx: number;
  cy: number;
  r: number;
  season: { current: { name?: string } | null; nextRollAt: string | null };
  /*
   * Screen pixels per world unit, so this label can be sized for a reader.
   *
   * The 11 below is WORLD units. On a 390px phone that measured 3.5px on
   * screen, which is the same defect `labelFit.ts` exists to close, in the
   * one place that did not go through it. Zero keeps the old behaviour for
   * any caller that does not measure.
   */
  pxPerWorld?: number;
}) {
  if (!season.current && !season.nextRollAt) return null;
  const days = daysUntil(season.nextRollAt);
  const label = [
    season.current?.name ?? null,
    season.nextRollAt && days !== null && days >= 0
      ? `rolls in ${days} day${days === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!label) return null;
  const pathId = `season-ring-${Math.round(cx)}-${Math.round(cy)}`;
  return (
    <g aria-hidden="true" opacity={0.8}>
      <circle cx={cx} cy={cy} r={r + 14} fill="none" stroke="var(--color-sage)" strokeWidth={1} strokeDasharray="2 5" opacity={0.6} />
      {/* The words ride the top of the ring, on their own arc. */}
      <path id={pathId} d={arcPath(cx, cy, r + 20, -Math.PI * 0.85, -Math.PI * 0.15)} fill="none" stroke="none" />
      <text fontSize={pxPerWorld > 0 ? Math.max(11, MIN_SEASON_PX / pxPerWorld) : 11} className="fill-muted-foreground">
        <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
          {label}
        </textPath>
      </text>
    </g>
  );
}
