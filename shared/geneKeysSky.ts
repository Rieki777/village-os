/**
 * THE SKY AT A BIRTH, READ IN THE MEMBER'S BROWSER.
 *
 * Birth date, time and place go in; a Chart (shared/geneKeys.ts) comes out, and
 * only the Chart is ever sent anywhere. This is the one file that imports
 * astronomy-engine, and the server must never import it: the library is for the
 * browser bundle and the tests, and server code that reached for it would read
 * the sky from data a member never sent.
 *
 * ── TIME ZONES MATCH genekeys.com ──────────────────────────────────────────
 *
 * Local birth time becomes UTC through the browser's own zone data (Intl). That
 * data has no pre-1970 history for zones the tz database has merged, so Iceland
 * in 1960 reads as UTC+0 though its clocks were on UTC-1. genekeys.com does the
 * same, and Rye ruled on 2026-10-22 to match it, so a member sees the same keys
 * on both sites.
 *
 * ── BIRTH TIME DECIDES MORE THAN IT LOOKS ──────────────────────────────────
 *
 * Every calendar day crosses at least one line change, and the Moon changes
 * gate every few hours. Assuming noon gets type wrong for about 13% of people;
 * an hour either way changes it for about 6%. `resultsAcross` finds every
 * distinct result in a span of minutes, each change to the minute, so the flow
 * can ask a member to choose instead of guessing for them.
 */
import * as Astronomy from "astronomy-engine";
import { analyse, gateLine, normDeg, profileOf, sphereOf, type Activations, type Chart, type Design } from "./geneKeys";

type AstroTime = Astronomy.AstroTime;

const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"] as const;

function sunLon(t: AstroTime): number {
  return Astronomy.SunPosition(t).elon;
}

function moonVector(t: AstroTime): [number, number, number] {
  const m = Astronomy.EclipticGeoMoon(t);
  const la = (m.lat * Math.PI) / 180, lo = (m.lon * Math.PI) / 180;
  return [m.dist * Math.cos(la) * Math.cos(lo), m.dist * Math.cos(la) * Math.sin(lo), m.dist * Math.sin(la)];
}

/** The osculating node: where the Moon's orbital plane at this instant cuts the ecliptic of date. */
export function trueNodeLon(t: AstroTime): number {
  const dt = 1 / 1440;
  const a = moonVector(t.AddDays(-dt)), b = moonVector(t.AddDays(dt)), r = moonVector(t);
  const v = [(b[0] - a[0]) / (2 * dt), (b[1] - a[1]) / (2 * dt), (b[2] - a[2]) / (2 * dt)];
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  return normDeg((Math.atan2(h[0], -h[1]) * 180) / Math.PI);
}

function activationsAt(t: AstroTime): Activations {
  const sun = sunLon(t), node = trueNodeLon(t);
  const lon: Record<string, number> = {
    Sun: sun, Earth: sun + 180, NorthNode: node, SouthNode: node + 180, Moon: Astronomy.EclipticGeoMoon(t).lon,
  };
  for (const p of PLANETS) lon[p] = Astronomy.Ecliptic(Astronomy.GeoVector(Astronomy.Body[p], t, true)).elon;
  return Object.fromEntries(Object.entries(lon).map(([k, v]) => [k, gateLine(v)])) as Activations;
}

/** The moment the Sun stood 88 degrees of arc before where it was at birth. */
export function designMoment(t: AstroTime): AstroTime {
  const target = normDeg(sunLon(t) - 88);
  let lo = t.AddDays(-96), hi = t.AddDays(-84);
  for (let i = 0; i < 50; i++) {
    const mid = Astronomy.MakeTime((lo.ut + hi.ut) / 2);
    if (normDeg(sunLon(mid) - target + 180) - 180 > 0) hi = mid; else lo = mid;
  }
  return Astronomy.MakeTime((lo.ut + hi.ut) / 2);
}

export function chartAt(utc: Date): Chart {
  const t = Astronomy.MakeTime(utc);
  return { personality: activationsAt(t), design: activationsAt(designMoment(t)) };
}

/** Wall-clock time in an IANA zone to the instant it names, with the browser's zone data. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  });
  const want = Date.UTC(year, month - 1, day, hour, minute);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(guess))) p[part.type] = Number(part.value);
    guess += want - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(guess);
}

export interface BirthResult {
  chart: Chart;
  design: Design;
  profile: string;
}

export function resultAt(utc: Date): BirthResult {
  const chart = chartAt(utc);
  return { chart, design: analyse(chart), profile: profileOf(chart) };
}

/** What a member would see change: their profile, type, authority, or an Activation key. */
function signature(r: BirthResult): string {
  const keys = (["lifesWork", "evolution", "radiance", "purpose"] as const).map((s) => {
    const a = sphereOf(r.chart, s);
    return `${a.gate}.${a.line}`;
  });
  return [r.profile, r.design.type, r.design.authority, ...keys].join("|");
}

export interface TimeWindow {
  /** Minutes after local midnight, inclusive. */
  from: number;
  /** Minutes after local midnight, exclusive. */
  to: number;
  result: BirthResult;
}

/**
 * Every distinct result for a birth on this local day between two minutes,
 * each boundary found to the minute. One window means birth time does not
 * matter in that span.
 */
export function resultsAcross(
  date: { year: number; month: number; day: number },
  timeZone: string,
  fromMinute: number,
  toMinute: number,
  step = 20,
): TimeWindow[] {
  const at = (m: number) => resultAt(zonedToUtc(date.year, date.month, date.day, Math.floor(m / 60), m % 60, timeZone));
  const windows: TimeWindow[] = [];
  let start = fromMinute, prevMinute = fromMinute, prev = at(fromMinute);
  for (let m = fromMinute + step; ; m += step) {
    const here = Math.min(m, toMinute);
    const cur = at(here);
    if (signature(cur) !== signature(prev)) {
      let lo = prevMinute, hi = here;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (signature(at(mid)) === signature(prev)) lo = mid; else hi = mid;
      }
      windows.push({ from: start, to: hi, result: prev });
      start = hi;
      prev = at(hi);
    }
    prevMinute = here;
    if (here >= toMinute) break;
  }
  windows.push({ from: start, to: toMinute + 1, result: prev });
  return windows;
}
