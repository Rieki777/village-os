/**
 * Village time on the client (0085): every date the calendar prints is in
 * the village's zone, named; the viewer's own clock is a second line only
 * when it differs. Pure helpers, no React, so a test can call them.
 */
import type { CalendarItem, LunarSummary } from "@shared/gatherings";
import { civilDate, civilDateKey, lunarPositionFor, moonPhase, zonedTimeToUtc, type YearAnchor } from "@shared/lunar";
import { moonCountLabel } from "@shared/villageMoon";

/** What GET /api/events answers since 0085. */
export interface EventsPayload {
  events: CalendarItem[];
  rsvpEnabled: boolean;
  timezone: string;
  window: { from: string; to: string };
  lunar: LunarSummary | null;
  anchor: YearAnchor;
  hemisphere: "north" | "south";
  monthNames: Array<{ index: number; name: string; isExample: boolean }>;
  /**
   * The lunation this village calls Moon 1, or null while it has not set one.
   *
   * Every moon number on this calendar is counted from here, so it travels
   * with the payload and is read once for a whole grid. Null is the honest
   * answer for a village that has not started counting, and a surface holding
   * null prints a window with no number on it.
   */
  moonOneCycle: number | null;
}

export const DEFAULT_ANCHOR: YearAnchor = "december_solstice";

/** The zone this browser lives in. */
export function viewerZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

const safeFormat = (date: Date, opts: Intl.DateTimeFormatOptions, timeZone: string): string => {
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(date); }
  catch { return new Intl.DateTimeFormat(undefined, opts).format(date); }
};

/** "CST" or "GMT-6": the short name a zone prints beside a time. */
export function zoneShortName(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch { return timeZone; }
}

/** "Tuesday, 18 August" in the village. */
export function villageDay(date: Date, timeZone: string): string {
  return safeFormat(date, { weekday: "long", day: "numeric", month: "long" }, timeZone);
}

/** "7:00 PM" in the village. */
export function villageClock(date: Date, timeZone: string): string {
  return safeFormat(date, { hour: "numeric", minute: "2-digit" }, timeZone);
}

/** The line under a title: village day and time, zone named. */
export function villageDateLine(item: Pick<CalendarItem, "startsAt" | "endsAt" | "allDay">, timeZone: string): string {
  const start = new Date(item.startsAt);
  if (item.allDay) {
    const end = item.endsAt ? new Date(item.endsAt) : null;
    if (end && civilDateKey(end, timeZone) !== civilDateKey(start, timeZone)) {
      // An all-day span ends at the midnight that opens the day after its last day.
      const lastDay = new Date(end.getTime() - 60_000);
      return `${villageDay(start, timeZone)} to ${villageDay(lastDay, timeZone)}`;
    }
    return villageDay(start, timeZone);
  }
  const when = `${villageDay(start, timeZone)}, ${villageClock(start, timeZone)}`;
  const end = item.endsAt ? new Date(item.endsAt) : null;
  const tail = end && civilDateKey(end, timeZone) === civilDateKey(start, timeZone) ? ` to ${villageClock(end, timeZone)}` : "";
  return `${when}${tail} ${zoneShortName(timeZone, start)}`;
}

/** The viewer's own clock for the same instant, or null when it reads the same. */
export function localSecondLine(item: Pick<CalendarItem, "startsAt" | "allDay">, timeZone: string): string | null {
  if (item.allDay) return null;
  const mine = viewerZone();
  if (mine === timeZone) return null;
  const start = new Date(item.startsAt);
  const village = `${civilDateKey(start, timeZone)} ${villageClock(start, timeZone)}`;
  const local = `${civilDateKey(start, mine)} ${villageClock(start, mine)}`;
  if (village === local) return null;
  return `${villageDay(start, mine)}, ${villageClock(start, mine)} where you are (${zoneShortName(mine, start)})`;
}

/** "Times are in America/Costa_Rica (CST)": the calendar's standing note. */
export function zoneNote(timeZone: string): string {
  return `Times are village time, ${timeZone.replace(/_/g, " ")} (${zoneShortName(timeZone)})`;
}

// ── Grids ───────────────────────────────────────────────────────────────────

/** A civil day in the village: its key and the instant it opens. */
export interface CivilDay {
  key: string;
  year: number;
  month: number;
  day: number;
  /** Midnight that opens the day, in the village. */
  startsAt: Date;
  /** Noon of the day, for the phase glyph. */
  noon: Date;
  /** The last minute of the day: the lunar lookup instant, so the day a new
   *  moon falls on (any hour of it) is day 1 of the new moon in the village. */
  endOfDay: Date;
  weekday: number;
}

export function civilDayFor(year: number, month: number, day: number, timeZone: string): CivilDay {
  const startsAt = zonedTimeToUtc(year, month, day, 0, 0, timeZone);
  const noon = zonedTimeToUtc(year, month, day, 12, 0, timeZone);
  const endOfDay = zonedTimeToUtc(year, month, day, 23, 59, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { key: `${year}-${pad(month)}-${pad(day)}`, year, month, day, startsAt, noon, endOfDay, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** Today's civil day in the village. */
export function todayIn(timeZone: string, now: Date = new Date()): CivilDay {
  const c = civilDate(now, timeZone);
  return civilDayFor(c.year, c.month, c.day, timeZone);
}

/** The civil day n days after `d`. */
export function addDays(d: CivilDay, n: number, timeZone: string): CivilDay {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return civilDayFor(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), timeZone);
}

/** The Gregorian month holding `d`, as Sunday-first weeks padded with neighbours. */
export function gregorianWeeks(year: number, month: number, timeZone: string): CivilDay[][] {
  const first = civilDayFor(year, month, 1, timeZone);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = addDays(first, -first.weekday, timeZone);
  const weeks: CivilDay[][] = [];
  let cursor = start;
  const lastKey = civilDayFor(year, month, daysInMonth, timeZone).key;
  let done = false;
  while (!done) {
    const week: CivilDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      if (cursor.key === lastKey) done = true;
      cursor = addDays(cursor, 1, timeZone);
    }
    weeks.push(week);
    if (weeks.length > 6) break;
  }
  return weeks;
}

/** The seven civil days of the week holding `d`, Sunday first. */
export function weekOf(d: CivilDay, timeZone: string): CivilDay[] {
  const start = addDays(d, -d.weekday, timeZone);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i, timeZone));
}

/** Where a civil day sits in the village's lunar year. */
export interface LunarDayInfo {
  monthIndex: number;
  monthCount: number;
  day: number;
  length: number;
  phase: number;
  /** True on the day a new moon falls (day 1). */
  newMoon: boolean;
  monthStartsAt: Date;
  monthEndsAt: Date;
  cycleNumber: number;
}

export function lunarDayInfo(d: CivilDay, anchor: YearAnchor, timeZone: string): LunarDayInfo | null {
  const p = lunarPositionFor(d.endOfDay, anchor, timeZone);
  if (!p) return null;
  return {
    monthIndex: p.month.index,
    monthCount: p.monthCount,
    day: p.day,
    length: p.length,
    phase: moonPhase(d.noon),
    newMoon: p.day === 1,
    monthStartsAt: p.month.startsAt,
    monthEndsAt: p.month.endsAt,
    cycleNumber: p.month.cycleNumber,
  };
}

/** The lunar month holding `d`, as weeks of seven lunar days (day 1 first). */
export function lunarWeeks(d: CivilDay, anchor: YearAnchor, timeZone: string): { info: LunarDayInfo; days: Array<{ day: CivilDay; lunarDay: number }>[] } | null {
  const info = lunarDayInfo(d, anchor, timeZone);
  if (!info) return null;
  const first = addDays(d, -(info.day - 1), timeZone);
  const cells: Array<{ day: CivilDay; lunarDay: number }> = [];
  for (let i = 0; i < info.length; i++) cells.push({ day: addDays(first, i, timeZone), lunarDay: i + 1 });
  const weeks: Array<{ day: CivilDay; lunarDay: number }[]> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { info, days: weeks };
}

/** Group items by the village civil day of their start. Multi-day spans land on each day they cover. */
export function itemsByDay(items: CalendarItem[], timeZone: string): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>();
  const push = (key: string, item: CalendarItem) => {
    const list = out.get(key) ?? [];
    list.push(item);
    out.set(key, list);
  };
  for (const item of items) {
    const start = new Date(item.startsAt);
    const startKey = civilDateKey(start, timeZone);
    push(startKey, item);
    // A season is a background to its whole span, and printing it in every
    // cell of three months buries the days; it lands on its first day only.
    if (item.endsAt && item.kind !== "season") {
      const end = new Date(item.endsAt);
      // An all-day span ends at the midnight after its last day; a timed one
      // covers every day it touches. Cap at 62 days so a bad row cannot flood.
      const lastInstant = item.allDay ? new Date(end.getTime() - 60_000) : end;
      const lastKey = civilDateKey(lastInstant, timeZone);
      let cur = new Date(Date.UTC(Number(startKey.slice(0, 4)), Number(startKey.slice(5, 7)) - 1, Number(startKey.slice(8, 10))));
      for (let guard = 0; guard < 62; guard++) {
        cur = new Date(cur.getTime() + 86_400_000);
        const key = cur.toISOString().slice(0, 10);
        if (key > lastKey) break;
        push(key, item);
      }
    }
  }
  out.forEach((list) => list.sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  return out;
}

/**
 * The label of a moon: THE VILLAGE'S OWN COUNT, and the moon's name.
 *
 * Two different numbers meet here and only one of them is printed. `index` is
 * the moon's place in the lunar year, 1 to 13, and it is what the NAME is
 * keyed by, because a village names the moons of its year and those names come
 * round again. `cycleNumber` against `moonOneCycle` is the count since the
 * village's first moon, which never resets, and that is the number a member
 * reads. Dating something takes one number now and never a pair.
 *
 * `title` is EMPTY for a village with no first moon set, and reads "Before
 * Moon 1" for a lunation earlier than the anchor. Neither is an accident and
 * neither is ever "Moon 0": compose with `moonHeading` below and a surface
 * with no count says the moon's name and its dates instead.
 */
export function moonLabel(
  index: number,
  cycleNumber: number,
  moonOneCycle: number | null,
  names: EventsPayload["monthNames"],
): { title: string; name: string; isExample: boolean } {
  const n = names.find((m) => m.index === index);
  return {
    title: moonCountLabel(cycleNumber, moonOneCycle),
    name: n?.name ?? "",
    isExample: n?.isExample ?? false,
  };
}

/** "Moon 47, Sturgeon Moon", with whichever half this village has. */
export function moonHeading(label: { title: string; name: string }): string {
  return [label.title, label.name].filter(Boolean).join(", ") || "This moon";
}

/**
 * The compact line a grid cell carries: the village's moon and the lunar day.
 *
 * "Moon 47, day 12" normally, "day 12" alone for a village that is not
 * counting yet. The day is always there, because the day is a fact about the
 * sky that no anchor is needed to state.
 */
export function moonDayLine(info: LunarDayInfo, moonOneCycle: number | null): string {
  const count = moonCountLabel(info.cycleNumber, moonOneCycle);
  return `${count ? `${count}, ` : ""}day ${info.day}`;
}

/** Kinds the sky writes; drawn as glyphs in cells rather than as list rows. */
export const SKY_KINDS = new Set(["sky"]);

/** A colour per kind when the row carries none. */
export function kindColour(item: Pick<CalendarItem, "kind" | "colour">): string {
  if (item.colour) return item.colour;
  switch (item.kind) {
    case "gathering": return "var(--tone-brand, #157f7d)";
    case "festival": return "var(--tone-sun, #ecb163)";
    case "quest-window": return "#15803d";
    case "season": return "#65a30d";
    case "sky": return "#6b7280";
    case "cycle-mark": return "#0f766e";
    case "seat-term": return "#7c3aed";
    case "loan-due": return "#b45309";
    case "notice-end": return "#be123c";
    case "milestone": return "#4338ca";
    case "external": return "#0369a1";
    default: return "#6b7280";
  }
}

/** Plain words for a kind, for badges and screen readers. */
export function kindLabel(kind: CalendarItem["kind"]): string {
  switch (kind) {
    case "gathering": return "Gathering";
    case "quest-window": return "Quest";
    case "festival": return "Festival";
    case "season": return "Season";
    case "sky": return "Sky";
    case "cycle-mark": return "Cycle";
    case "seat-term": return "Role";
    case "call": return "Call";
    case "loan-due": return "Loan due";
    case "notice-end": return "Notice";
    case "milestone": return "Milestone";
    case "external": return "Imported";
    case "meet-me": return "Meet";
    default: return kind;
  }
}
