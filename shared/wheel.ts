/**
 * THE CYCLE CLOCK's arithmetic (Rye, 2026-08-01): the wheel-of-the-year's
 * STRUCTURE — quarters, seasons, lunations, one circle — with none of any
 * tradition's language, so it is open to every worldview. Astronomy is the
 * only authority here: equal days and longest/shortest days are true
 * everywhere and owned by no one, and they INVERT by hemisphere, which a
 * computed wheel gets right and a copied one gets wrong.
 *
 * Quarter dates use fixed civil approximations (Mar 20 / Jun 21 / Sep 22 /
 * Dec 21) — within a day of the astronomical event through this century,
 * and this clock marks rhythm, not ephemerides.
 */

import {
  civilParts,
  lunarYearOf,
  seasonInstants,
  zonedTimeToUtc,
  type LunarMonth,
  type YearAnchor,
} from "./lunar";

export type Hemisphere = "north" | "south";

export interface QuarterMark {
  /** Neutral names: no sabbats, no festivals — villages name their own. */
  label: "Equal Day & Night" | "Longest Day" | "Shortest Day";
  month: number; // 1-12
  day: number;
  /** Fraction of the year-circle, 0 at Jan 1, clockwise. */
  angle: number;
}

const QUARTERS: Array<{ month: number; day: number; north: QuarterMark["label"] }> = [
  { month: 3, day: 20, north: "Equal Day & Night" },
  { month: 6, day: 21, north: "Longest Day" },
  { month: 9, day: 22, north: "Equal Day & Night" },
  { month: 12, day: 21, north: "Shortest Day" },
];

export function quarterMarks(hemisphere: Hemisphere): QuarterMark[] {
  return QUARTERS.map((q) => ({
    label:
      hemisphere === "north" || q.north === "Equal Day & Night"
        ? q.north
        : q.north === "Longest Day"
          ? "Shortest Day"
          : "Longest Day",
    month: q.month,
    day: q.day,
    angle: yearAngle(q.month, q.day),
  }));
}

/** Fraction [0,1) around the year for a calendar date (non-leap basis). */
export function yearAngle(month: number, day: number): number {
  const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return ((CUM[month - 1] + (day - 1)) % 365) / 365;
}

/** Today's position on the wheel plus the current lunation's fraction. */
export function wheelState(now: Date, moonAgeDays: number, hemisphere: Hemisphere) {
  const angle = yearAngle(now.getMonth() + 1, now.getDate());
  return {
    yearAngle: angle,
    lunationFraction: Math.max(0, Math.min(1, moonAgeDays / 29.53)),
    quarters: quarterMarks(hemisphere),
  };
}

// ── The two-ring year wheel (0085, lane L5a) ─────────────────────────────────
//
// The CycleClock above draws one year ring and one lunation ring. The
// calendar's YearWheel draws twelve Gregorian months on the outer ring and
// the year's TRUE lunations on the inner ring as arcs of real length, with
// the four solar turnings as spokes through both. Everything here is angle
// arithmetic in village time; the sky itself comes from shared/lunar.ts.

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInYear = (y: number) => (isLeap(y) ? 366 : 365);
const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/**
 * Fraction [0,1) around the year for an instant, in a zone, leap-aware. The
 * midnight that opens 1 January in the village is 0; the last moment of the
 * year approaches 1. Instants outside `year` clamp to its edges.
 */
export function instantYearAngle(date: Date, year: number, timeZone: string): number {
  const c = civilParts(date, timeZone);
  if (c.year < year) return 0;
  if (c.year > year) return 1;
  const leapShift = isLeap(year) && c.month > 2 ? 1 : 0;
  const dayOfYear = CUM_DAYS[c.month - 1] + leapShift + (c.day - 1);
  const dayFraction = (c.hour * 60 + c.minute) / (24 * 60);
  return Math.min(1, Math.max(0, (dayOfYear + dayFraction) / daysInYear(year)));
}

export interface WheelArc {
  key: string;
  label: string;
  /** Fractions of the year circle, 0 at 1 January, clockwise. */
  startAngle: number;
  endAngle: number;
}

/** The twelve months of a Gregorian year as arcs. */
export function gregorianMonthArcs(year: number): WheelArc[] {
  const total = daysInYear(year);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return names.map((label, i) => {
    const start = CUM_DAYS[i] + (isLeap(year) && i >= 2 ? 1 : 0);
    const days = i === 11 ? total - start : CUM_DAYS[i + 1] + (isLeap(year) && i + 1 >= 2 ? 1 : 0) - start;
    return { key: `m${i + 1}`, label, startAngle: start / total, endAngle: (start + days) / total };
  });
}

export interface LunarArc extends WheelArc {
  /** 1-based month in its lunar year; 13 is the intercalary moon. */
  index: number;
  /** How many moons that lunar year holds. */
  monthCount: number;
  /** The Gregorian year of the anchor that opened its lunar year. */
  anchorYear: number;
  cycleNumber: number;
  startsAt: Date;
  endsAt: Date;
  /** True when this arc is cut by the year's edge and continues beyond it. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Every true lunation that touches the Gregorian year, as an arc of its real
 * length clipped to the year's edges, labelled with its place in the
 * village's lunar year. Two lunar years usually cross one Gregorian year.
 */
export function lunarMonthArcs(year: number, anchor: YearAnchor, timeZone: string): LunarArc[] {
  const yearStart = zonedTimeToUtc(year, 1, 1, 0, 0, timeZone).getTime();
  const yearEnd = zonedTimeToUtc(year + 1, 1, 1, 0, 0, timeZone).getTime();
  const out: LunarArc[] = [];
  // The lunar year opened two anchors back can still run into January
  // (a December-solstice year whose last moon ends mid-January), so three
  // anchor years are tried and only arcs touching this year survive.
  for (const anchorYear of [year - 2, year - 1, year]) {
    const ly = lunarYearOf(anchorYear, anchor);
    if (!ly) continue;
    for (const m of ly.months as LunarMonth[]) {
      const s = m.startsAt.getTime();
      const e = m.endsAt.getTime();
      if (e <= yearStart || s >= yearEnd) continue;
      out.push({
        key: `l${anchorYear}-${m.index}`,
        // The moon's POSITION IN THE LUNAR YEAR, said so plainly because
        // the wheel prints the village count in the arc instead and a bare
        // "Moon 3" here would be a second number waiting for a renderer to
        // print it beside the first one.
        label: `Moon ${m.index} of the year`,
        index: m.index,
        monthCount: ly.months.length,
        anchorYear,
        cycleNumber: m.cycleNumber,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        startAngle: instantYearAngle(m.startsAt, year, timeZone),
        endAngle: instantYearAngle(m.endsAt, year, timeZone),
        clippedStart: s < yearStart,
        clippedEnd: e > yearEnd,
      });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export interface SolarSpoke {
  label: QuarterMark["label"];
  /** "mar" | "jun" | "sep" | "dec": which turning. */
  which: "mar" | "jun" | "sep" | "dec";
  at: Date;
  angle: number;
}

/**
 * The four solar turnings of a year as spokes, from the true instants where
 * the table has them and the fixed civil dates where it does not.
 */
export function solarSpokes(year: number, hemisphere: Hemisphere, timeZone: string): SolarSpoke[] {
  const s = seasonInstants(year);
  const label = (which: "mar" | "jun" | "sep" | "dec"): QuarterMark["label"] => {
    if (which === "mar" || which === "sep") return "Equal Day & Night";
    const longest = (which === "jun") === (hemisphere === "north");
    return longest ? "Longest Day" : "Shortest Day";
  };
  if (s) {
    const four: Array<["mar" | "jun" | "sep" | "dec", Date]> = [
      ["mar", s.marEquinox], ["jun", s.junSolstice], ["sep", s.sepEquinox], ["dec", s.decSolstice],
    ];
    return four.map(([which, at]) => ({ which, at, label: label(which), angle: instantYearAngle(at, year, timeZone) }));
  }
  return QUARTERS.map((q, i) => {
    const which = (["mar", "jun", "sep", "dec"] as const)[i];
    return { which, at: new Date(Date.UTC(year, q.month - 1, q.day)), label: label(which), angle: yearAngle(q.month, q.day) };
  });
}
