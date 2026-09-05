/**
 * The two-ring year wheel (0085): the calendar's identity, its year page and
 * its print poster.
 *
 * Outer ring: the twelve Gregorian months. Inner ring: the year's true
 * lunations as arcs of real length, a new-moon tick at each boundary. Four
 * solar spokes cut both rings at the true instants. Today is a hand. Tap a
 * month arc to open that month; tap a moon arc to open that moon.
 *
 * TWO NUMBERS MEET IN THE INNER RING AND ONLY ONE IS DRAWN. The year still
 * has twelve or thirteen moons, opening at the first new moon after the year
 * anchor, and that position is what each moon's NAME belongs to. The number
 * inside an arc is the village's own count since its first moon, which never
 * resets, so a member reads one number for a moon wherever they meet it. An
 * arc carries no number at all for a village that has not set a first moon.
 *
 * Grown from CycleClock.tsx, which already drew the year ring and the
 * lunation ring in the village's palette; the same tokens paint this.
 */
import { useMemo } from "react";
import type { CalendarItem } from "@shared/gatherings";
import type { YearAnchor } from "@shared/lunar";
import { gregorianMonthArcs, instantYearAngle, lunarMonthArcs, solarSpokes, type Hemisphere } from "@shared/wheel";
import PrintButton from "./PrintButton";
import { kindColour, moonHeading, moonLabel, zoneNote, type EventsPayload } from "./calendarTime";
import { villageMoonOrdinal } from "@shared/villageMoon";

const T = {
  brand: "var(--tone-brand, #157f7d)",
  soft: "var(--tone-brand-soft, #7fb8ac)",
  mist: "var(--tone-mist-light, #c6dde0)",
  sun: "var(--tone-sun, #ecb163)",
  cream: "var(--tone-cream, #efe8d7)",
  ink: "var(--foreground, #1a3a39)",
};

const anchorWords = (a: YearAnchor) => ({ december_solstice: "December solstice", march_equinox: "March equinox", june_solstice: "June solstice", september_equinox: "September equinox" })[a] ?? a;

const C = 200; // centre
const pt = (angle: number, r: number) => {
  const a = angle * 2 * Math.PI - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};

/** An SVG annulus sector from angle a to b (fractions of the circle). */
function ring(a: number, b: number, rIn: number, rOut: number): string {
  const span = b - a;
  if (span <= 0) return "";
  const large = span > 0.5 ? 1 : 0;
  const [x1, y1] = pt(a, rOut);
  const [x2, y2] = pt(b, rOut);
  const [x3, y3] = pt(b, rIn);
  const [x4, y4] = pt(a, rIn);
  return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4} Z`;
}

export interface YearWheelProps {
  year: number;
  timezone: string;
  anchor: YearAnchor;
  hemisphere: Hemisphere;
  monthNames: EventsPayload["monthNames"];
  /** The lunation this village calls Moon 1; null while it has none. */
  moonOneCycle: number | null;
  /** Items to mark on the outer ring (gatherings and festivals). */
  items?: CalendarItem[];
  now?: Date;
  onPickMonth?: (year: number, month: number) => void;
  onPickMoon?: (startsAt: Date) => void;
}

export default function YearWheel({ year, timezone, anchor, hemisphere, monthNames, moonOneCycle, items = [], now = new Date(), onPickMonth, onPickMoon }: YearWheelProps) {
  const months = useMemo(() => gregorianMonthArcs(year), [year]);
  const moons = useMemo(() => lunarMonthArcs(year, anchor, timezone), [year, anchor, timezone]);
  const spokes = useMemo(() => solarSpokes(year, hemisphere, timezone), [year, hemisphere, timezone]);
  const todayAngle = instantYearAngle(now, year, timezone);
  const showHand = now.getUTCFullYear() === year || (todayAngle > 0 && todayAngle < 1);
  const marks = useMemo(
    () => items
      .filter((i) => i.kind === "gathering" || i.kind === "festival" || i.kind === "external")
      .map((i) => ({ key: `${i.id}:${i.occurrenceKey}`, angle: instantYearAngle(new Date(i.startsAt), year, timezone), colour: kindColour(i), title: i.title }))
      .filter((m) => m.angle > 0 && m.angle < 1),
    [items, year, timezone],
  );
  const moonYears = Array.from(new Set(moons.map((m) => `${m.anchorYear}:${m.monthCount}`)));

  return (
    <figure className="calendar-print mx-auto max-w-[520px]" aria-label={`Year wheel for ${year}: twelve months on the outer ring, ${moons.length} moons on the inner ring`}>
      {/* 0088: the wheel is the year's print poster. */}
      <div className="print-header">
        The wheel of {year}
        <span className="print-header-sub">{zoneNote(timezone)}</span>
      </div>
      <div className="flex justify-end mb-1">
        <PrintButton label="Print the wheel" />
      </div>
      <svg viewBox="0 0 400 400" role="img" aria-hidden="true" style={{ display: "block", width: "100%", height: "auto" }}>
        {/* the outer ring: twelve months */}
        {months.map((m, i) => {
          const mid = (m.startAngle + m.endAngle) / 2;
          const [lx, ly] = pt(mid, 178);
          const rot = mid * 360;
          return (
            <g key={m.key} onClick={() => onPickMonth?.(year, i + 1)} style={{ cursor: onPickMonth ? "pointer" : "default" }}>
              <path d={ring(m.startAngle, m.endAngle, 160, 196)} fill={i % 2 ? T.mist : T.cream} stroke="#fff" strokeWidth="1.5" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={T.ink} fontWeight="600"
                transform={`rotate(${rot > 90 && rot < 270 ? rot + 180 : rot} ${lx} ${ly})`}>
                {m.label.slice(0, 3)}
              </text>
            </g>
          );
        })}
        {/* items on the outer edge */}
        {marks.map((m) => {
          const [x, y] = pt(m.angle, 191);
          return <circle key={m.key} cx={x} cy={y} r="2.6" fill={m.colour} stroke="#fff" strokeWidth="0.8"><title>{m.title}</title></circle>;
        })}
        {/* the inner ring: true lunations */}
        {moons.map((m) => {
          const mid = (m.startAngle + m.endAngle) / 2;
          const [lx, ly] = pt(mid, 132);
          const isBlue = m.index === 13;
          const fill = isBlue ? T.sun : m.index % 2 ? T.soft : T.brand;
          const [tx1, ty1] = pt(m.startAngle, 110);
          const [tx2, ty2] = pt(m.startAngle, 156);
          const wide = m.endAngle - m.startAngle > 0.03;
          return (
            <g key={m.key} onClick={() => onPickMoon?.(m.startsAt)} style={{ cursor: onPickMoon ? "pointer" : "default" }}>
              <path d={ring(m.startAngle, m.endAngle, 112, 154)} fill={fill} opacity={m.index % 2 || isBlue ? 0.85 : 0.75} stroke="#fff" strokeWidth="1.5" />
              {!m.clippedStart && <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="#fff" strokeWidth="2" />}
              {wide && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fill="#fff" fontWeight="700"
                  transform={`rotate(${mid * 360 > 90 && mid * 360 < 270 ? mid * 360 + 180 : mid * 360} ${lx} ${ly})`}>
                  {/* THE VILLAGE'S COUNT, or nothing. `villageMoonOrdinal`
                      answers null for a village with no first moon and for
                      any lunation before it, and an arc with no number is
                      the honest drawing of both. It is never 0 and never
                      negative, which is the whole rule this counter keeps. */}
                  {villageMoonOrdinal(m.cycleNumber, moonOneCycle) ?? ""}
                </text>
              )}
              <title>{moonHeading(moonLabel(m.index, m.cycleNumber, moonOneCycle, monthNames))}</title>
            </g>
          );
        })}
        {/* the four solar spokes, through both rings */}
        {spokes.map((s) => {
          const [x1, y1] = pt(s.angle, 104);
          const [x2, y2] = pt(s.angle, 200);
          const [lx, ly] = pt(s.angle, 92);
          return (
            <g key={s.which}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={T.sun} strokeWidth="2.5" strokeDasharray="3 2" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="7.5" fill={T.brand} opacity="0.9">
                {s.label === "Equal Day & Night" ? "Equinox" : "Solstice"}
              </text>
            </g>
          );
        })}
        {/* the centre */}
        <circle cx={C} cy={C} r="78" fill={T.cream} opacity="0.9" />
        <text x={C} y={C - 12} textAnchor="middle" fontSize="20" fill={T.brand} fontWeight="700">{year}</text>
        <text x={C} y={C + 6} textAnchor="middle" fontSize="8.5" fill={T.ink} opacity="0.75">
          {moonYears.length === 1
            ? `${moonYears[0].split(":")[1]} moons this year`
            : moonYears.map((y) => `${y.split(":")[1]} moons`).join(", then ")}
        </text>
        <text x={C} y={C + 20} textAnchor="middle" fontSize="7.5" fill={T.ink} opacity="0.6">
          {`The year's first moon follows the ${anchorWords(anchor)}`}
        </text>
        {/* today: a hand from the centre to the outer edge */}
        {showHand && (() => {
          const [hx, hy] = pt(todayAngle, 198);
          const [dx, dy] = pt(todayAngle, 191);
          return (
            <g>
              <line x1={C} y1={C} x2={hx} y2={hy} stroke={T.sun} strokeWidth="2" opacity="0.9" />
              <circle cx={dx} cy={dy} r="5.5" fill={T.sun} stroke="#fff" strokeWidth="1.5" />
            </g>
          );
        })()}
      </svg>
      <figcaption className="sr-only">
        The year as two rings: twelve months outside, the true lunations inside as arcs of their real length,
        the four solar turnings as spokes, and today as a hand.
      </figcaption>
    </figure>
  );
}
