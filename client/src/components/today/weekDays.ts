/**
 * THE WEEK, as seven days from today: the model under the week strip on
 * Profile Today (for residents and players, and for a holder once the first
 * fourteen days have passed).
 *
 * Pure, so the rules are held by tests with no page:
 *   - seven days, today first, each a calendar day where the reader is;
 *   - what lands on a day is what already exists for this member: the next
 *     meeting of each circle they sit in, the gatherings the calendar shows
 *     them, and the day their nearest task is due. Nothing is invented;
 *   - the new and the full moon are marked on the day they fall, from the
 *     real sky (shared/lunar), never a fixed weekday;
 *   - a day keeps its items in time order, and an item with no hour (a task
 *     due that day) comes first.
 *
 * No countdowns and no hours left: a day is a date.
 */
import { fullMoonsBetween, newMoonsBetween } from "@shared/lunar";

export type WeekItemKind = "meeting" | "gathering" | "task";

export interface WeekItem {
  kind: WeekItemKind;
  title: string;
  /** An instant (ISO) for a timed item, or a bare YYYY-MM-DD for a day-long one. */
  at: string;
  href: string;
}

export interface WeekDay {
  /** YYYY-MM-DD where the reader is. */
  key: string;
  date: Date;
  today: boolean;
  items: WeekItem[];
  moon: "new" | "full" | null;
}

/** A local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The local day an item lands on: a bare date is that day where the reader is, never UTC midnight moved. */
export function itemDay(at: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? dayKey(d) : null;
}

const timed = (at: string) => !/^\d{4}-\d{2}-\d{2}$/.test(at);

export function weekDays(now: Date, items: readonly WeekItem[]): WeekDay[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { key: dayKey(date), date, today: i === 0, items: [], moon: null };
  });
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  for (const m of newMoonsBetween(start, end)) {
    const d = days.find((x) => x.key === dayKey(m));
    if (d) d.moon = "new";
  }
  for (const m of fullMoonsBetween(start, end)) {
    const d = days.find((x) => x.key === dayKey(m));
    if (d) d.moon = "full";
  }
  for (const it of items) {
    const key = itemDay(it.at);
    const d = key ? days.find((x) => x.key === key) : undefined;
    if (d) d.items.push(it);
  }
  for (const d of days) {
    d.items.sort((a, b) => (timed(a.at) ? 1 : 0) - (timed(b.at) ? 1 : 0) || Date.parse(a.at) - Date.parse(b.at));
  }
  return days;
}

/** True when nothing at all is on the week: the strip then says so and offers the calendar. */
export const quietWeek = (days: readonly WeekDay[]): boolean => days.every((d) => d.items.length === 0);
