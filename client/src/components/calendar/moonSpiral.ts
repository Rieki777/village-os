/**
 * THE MOON AS A GOLDEN SPIRAL OF DAYS (Phase C, decision 3). Pure maths and
 * pure date work, no React and no DOM, so the drawing a member sees can be
 * tested as numbers.
 *
 * THE SPIRAL. A golden spiral is the logarithmic spiral r = a * e^(b*theta)
 * whose radius grows by phi every quarter turn, so b = ln(phi) / (pi/2). The
 * nautilus and the fern's crozier come close to it, which is why it reads as
 * something growing. The new moon sits at the centre and each day of the moon
 * is a seed further out along the curve, spaced by ARC LENGTH, so the days
 * keep an even walk however fast the spiral opens.
 *
 * The very first turn is too tight to hold a readable seed, so the days start
 * a little way along (`start`, a fraction of the whole length), and the thread
 * drawn behind them starts a little before that so day 1 sits on it.
 *
 * THE DAYS. `moonDays` turns one lunar month of the village calendar into the
 * list the spiral, the strip and the turnings read: which day is today, which
 * are already walked, where the full moon falls, which days hold a gathering.
 * Growth here describes the moon's days and never a person: nothing on this
 * calendar counts what anybody did.
 */
import type { CalendarItem } from "@shared/gatherings";
import { closingNewMoonDay, halfwayDay, type RhythmBounds } from "@shared/moonRhythm";
import { addDays, lunarDayInfo, type CivilDay, type LunarDayInfo } from "./calendarTime";
import type { YearAnchor } from "@shared/lunar";

export const PHI = (1 + Math.sqrt(5)) / 2;
/** The golden spiral's growth rate: the radius gains a factor of phi per quarter turn. */
export const GOLDEN_B = Math.log(PHI) / (Math.PI / 2);

/** Radius of the golden spiral at angle theta, for a spiral of scale a. */
export function goldenRadius(theta: number, a = 1): number {
  return a * Math.exp(GOLDEN_B * theta);
}

export interface SpiralPoint {
  x: number;
  y: number;
}

export interface SpiralOptions {
  /** How many whole turns the spiral makes. */
  turns?: number;
  /** Where the first day sits, as a fraction of the curve's length. */
  start?: number;
  /** Space kept clear inside the box on every side. */
  margin?: number;
  /** Samples along the curve; more is smoother and slower. */
  samples?: number;
}

export interface SpiralFit {
  /** One point per day, day 1 first, nearest the centre. */
  days: SpiralPoint[];
  /** The thread behind the days, as an SVG path. */
  path: string;
  /** Where the spiral starts: the new moon's place. */
  centre: SpiralPoint;
  /** The scale applied to fit the box, so a caller can size marks with it. */
  scale: number;
}

const r2 = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

/**
 * The days of a moon on a golden spiral, fitted to a width by height box.
 *
 * Deterministic: the same arguments give the same drawing on every render,
 * every device and every test run.
 */
export function goldenSpiralDays(count: number, width: number, height: number, opts: SpiralOptions = {}): SpiralFit {
  const n = Math.max(1, Math.floor(count));
  const turns = opts.turns ?? 1.85;
  const start = Math.min(0.9, Math.max(0, opts.start ?? 0.16));
  const margin = opts.margin ?? 24;
  const steps = Math.max(60, Math.floor(opts.samples ?? 600));
  const tMax = turns * 2 * Math.PI;

  // Sample the curve with its running arc length. The spiral opens to the
  // left of the centre (theta + pi), so day 1 starts on the left and the
  // moon grows clockwise round to the right, the way a day's light moves.
  const samples: Array<{ x: number; y: number; s: number }> = [];
  let total = 0;
  for (let i = 0; i <= steps; i++) {
    const t = (tMax * i) / steps;
    const r = goldenRadius(t);
    const x = r * Math.cos(t + Math.PI);
    const y = r * Math.sin(t + Math.PI);
    if (samples.length) {
      const p = samples[samples.length - 1];
      total += Math.hypot(x - p.x, y - p.y);
    }
    samples.push({ x, y, s: total });
  }

  const s0 = total * start;
  const raw: SpiralPoint[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = n === 1 ? s0 : s0 + ((total - s0) * k) / (n - 1);
    while (j < samples.length - 1 && samples[j].s < target) j++;
    // Between two samples, by the share of the arc: no day snaps to the grid.
    const hi = samples[j];
    const lo = samples[Math.max(0, j - 1)];
    const span = hi.s - lo.s;
    const f = span > 0 ? Math.min(1, Math.max(0, (target - lo.s) / span)) : 0;
    raw.push({ x: lo.x + (hi.x - lo.x) * f, y: lo.y + (hi.y - lo.y) * f });
  }
  const thread = samples.filter((q) => q.s >= s0 * 0.6);

  // Fit the thread, the days and the centre into the box, keeping the aspect.
  const all = [...thread, ...raw, { x: 0, y: 0 }];
  const xs = all.map((q) => q.x);
  const ys = all.map((q) => q.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const innerW = Math.max(1, width - 2 * margin);
  const innerH = Math.max(1, height - 2 * margin);
  const scale = Math.min(innerW / Math.max(1e-9, x1 - x0), innerH / Math.max(1e-9, y1 - y0));
  const ox = (width - (x1 - x0) * scale) / 2;
  const oy = (height - (y1 - y0) * scale) / 2;
  const T = (q: { x: number; y: number }): SpiralPoint => ({ x: r2(ox + (q.x - x0) * scale), y: r2(oy + (q.y - y0) * scale) });

  const path = thread.length
    ? "M " + thread.map((q) => { const p = T(q); return `${p.x} ${p.y}`; }).join(" L ")
    : "";
  return { days: raw.map(T), path, centre: T({ x: 0, y: 0 }), scale };
}

// ── The days of one moon ─────────────────────────────────────────────────────

/** What one day of the moon carries for the drawing. */
export interface MoonDay {
  day: CivilDay;
  /** 1 on the new moon. */
  lunarDay: number;
  /** Before today, inside this moon. */
  walked: boolean;
  today: boolean;
  /** The civil day the moon is full on. */
  fullMoon: boolean;
  /** Day 1: the new moon opens the moon. */
  newMoon: boolean;
  /** A gathering, festival or imported meeting falls on this day. */
  gathering: boolean;
  /** Anything else dated falls on it (a quest window, a role's term, a cycle mark). */
  marked: boolean;
}

export interface MoonOfDays {
  info: LunarDayInfo;
  days: MoonDay[];
  /** The civil day keys of the moon's turnings. */
  newMoonKey: string;
  fullMoonKey: string | null;
  /** The day the next moon opens: the civil date of the closing new moon. */
  nextNewMoonKey: string;
}

/** A kind a person might come to: these days take the gathering ring. */
const GATHER_KINDS = new Set<CalendarItem["kind"]>(["gathering", "festival", "external", "meet-me", "call"]);

/**
 * The lunar month holding `cursor`, as days for the spiral.
 *
 * The full moon and the closing new moon come from the moon rhythm
 * (`shared/moonRhythm.ts`), the same civil-date rule the end-of-moon review
 * keeps, so the calendar and the moon board name the same day. Sky rows are
 * left out of the marks: the sky is drawn as the moon itself.
 */
export function moonDays(
  cursor: CivilDay,
  today: CivilDay,
  anchor: YearAnchor,
  timeZone: string,
  byDay: ReadonlyMap<string, readonly CalendarItem[]>,
): MoonOfDays | null {
  const info = lunarDayInfo(cursor, anchor, timeZone);
  if (!info) return null;
  const first = addDays(cursor, -(info.day - 1), timeZone);
  const bounds: RhythmBounds = {
    id: `moon-${info.cycleNumber}`,
    clock: "lunar",
    startsAt: info.monthStartsAt,
    endsAt: info.monthEndsAt,
  };
  const fullMoonKey = halfwayDay(bounds, timeZone);
  const nextNewMoonKey = closingNewMoonDay(bounds, timeZone);
  const days: MoonDay[] = [];
  for (let i = 0; i < info.length; i++) {
    const d = addDays(first, i, timeZone);
    const items = (byDay.get(d.key) ?? []).filter((it) => it.kind !== "sky");
    const gathering = items.some((it) => GATHER_KINDS.has(it.kind) && it.status !== "cancelled");
    days.push({
      day: d,
      lunarDay: i + 1,
      walked: d.key < today.key,
      today: d.key === today.key,
      fullMoon: d.key === fullMoonKey,
      newMoon: i === 0,
      gathering,
      marked: !gathering && items.length > 0,
    });
  }
  return { info, days, newMoonKey: first.key, fullMoonKey, nextNewMoonKey };
}

/**
 * The day an arrow key lands on: one step along the moon, and across into the
 * next or the previous moon at either end, so the keyboard can walk the year.
 */
export function stepDay(day: CivilDay, key: string, timeZone: string): CivilDay | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return addDays(day, 1, timeZone);
    case "ArrowLeft":
    case "ArrowDown":
      return addDays(day, -1, timeZone);
    default:
      return null;
  }
}
