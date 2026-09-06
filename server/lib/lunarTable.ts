/**
 * The village's lunar year, named (0085).
 *
 * shared/lunar.ts knows the sky: which new moon opens month 1 for a given
 * anchor, how many moons the year holds, which day of which moon an instant
 * falls on in the village zone. This file adds the one thing the sky cannot
 * supply, the NAMES, and hands routes a summary they can print beside a
 * window ("Moon 8, Sturgeon Moon, day 5 of 30").
 *
 * Names live in calendar_month_names: number plus a village-chosen word.
 * They ship as almanac examples flagged is_example, because Wolf and
 * Sturgeon describe someone else's land; a village writes its own over them
 * and the example pill goes away for that month. South of the equator the
 * example names rotate by six months, since a January moon there is a
 * midsummer moon; a name the village typed is never rotated.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { LunarSummary } from "../../shared/gatherings";
import { civilDate, lunarPositionFor, moonPhase, moonPhaseName, zonedTimeToUtc, type YearAnchor } from "../../shared/lunar";

/** The seed 0085 wrote, kept here so a blanked name falls back to it. */
export const EXAMPLE_MONTH_NAMES: readonly string[] = [
  "Wolf Moon", "Snow Moon", "Worm Moon", "Pink Moon", "Flower Moon", "Strawberry Moon",
  "Buck Moon", "Sturgeon Moon", "Harvest Moon", "Hunter Moon", "Beaver Moon", "Cold Moon",
  "Blue Moon",
];

export interface MonthName {
  index: number;
  name: string;
  isExample: boolean;
}

/** All thirteen, in order, from the table; a missing row takes the example. */
export async function listMonthNames(pool: Pool): Promise<MonthName[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT month_index, name, is_example FROM calendar_month_names ORDER BY month_index",
  );
  const byIndex = new Map<number, MonthName>();
  for (const r of rows) {
    byIndex.set(Number(r.month_index), { index: Number(r.month_index), name: String(r.name), isExample: Boolean(r.is_example) });
  }
  return EXAMPLE_MONTH_NAMES.map((example, i) => byIndex.get(i + 1) ?? { index: i + 1, name: example, isExample: true });
}

/**
 * The names as the village sees them: example names rotate by six for a
 * southern village (the thirteenth stays), typed names never move.
 */
export function namesForHemisphere(names: MonthName[], hemisphere: "north" | "south"): MonthName[] {
  if (hemisphere !== "south") return names;
  return names.map((n) => {
    if (!n.isExample || n.index > 12) return n;
    const shifted = ((n.index - 1 + 6) % 12) + 1;
    return { ...n, name: EXAMPLE_MONTH_NAMES[shifted - 1] };
  });
}

/** Set one month's name. Blank restores the example. Returns the row as stored. */
export async function setMonthName(pool: Pool, index: number, rawName: string): Promise<MonthName | null> {
  if (!Number.isInteger(index) || index < 1 || index > 13) return null;
  const name = String(rawName ?? "").trim().slice(0, 80);
  const isExample = name === "";
  const stored = isExample ? EXAMPLE_MONTH_NAMES[index - 1] : name;
  await pool.query(
    "INSERT INTO calendar_month_names (month_index, name, is_example) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE name = VALUES(name), is_example = VALUES(is_example)",
    [index, stored, isExample ? 1 : 0],
  );
  return { index, name: stored, isExample };
}

export interface LunarSettings {
  anchor: YearAnchor;
  timezone: string;
  hemisphere: "north" | "south";
  names: MonthName[];
}

/**
 * Where `date` sits in the village's lunar year, with its name. Null outside
 * the table. The lookup is made at the last minute of the village day, the
 * same instant the client's grid uses, so the day a new moon falls on is day
 * 1 from its first hour and the summary never disagrees with the cell.
 */
export function lunarSummaryFor(date: Date, s: LunarSettings): LunarSummary | null {
  const c = civilDate(date, s.timezone);
  const endOfDay = zonedTimeToUtc(c.year, c.month, c.day, 23, 59, s.timezone);
  const p = lunarPositionFor(endOfDay, s.anchor, s.timezone);
  if (!p) return null;
  const names = namesForHemisphere(s.names, s.hemisphere);
  const named = names.find((n) => n.index === p.month.index);
  const phase = moonPhase(date);
  return {
    monthIndex: p.month.index,
    cycleNumber: p.month.cycleNumber,
    monthCount: p.monthCount,
    // BLANK, never `Moon <year index>`. That fallback put the moon's place
    // in the lunar year into a field that is a NAME, and since the village
    // moon count landed it would have read as a village moon number that is
    // wrong by however many years the village has run. `listMonthNames`
    // returns all thirteen with examples, so a caller reaching this line has
    // handed in a short list and gets no name rather than a made-up one.
    name: named?.name ?? "",
    isExampleName: named?.isExample ?? true,
    day: p.day,
    length: p.length,
    monthStartsAt: p.month.startsAt.toISOString(),
    monthEndsAt: p.month.endsAt.toISOString(),
    phase,
    phaseName: moonPhaseName(phase),
  };
}
