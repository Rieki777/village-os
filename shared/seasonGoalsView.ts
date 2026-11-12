/**
 * The season as a page shows it: name, dates and goals, read from the live
 * season (`GET /api/season`, the Season tab in Admin). Nothing here is a list
 * of goals. A page that draws these shows whatever the village set, so the
 * page changes when the season does.
 */
import { civilDayWords } from "./seasonPlans";

export interface SeasonGoalView {
  id: string;
  text: string;
  done: boolean;
  /**
   * The goal's own id as the season stores it (0298, `g` and hex), or null for
   * a goal that came without one. Only a real id may name the goal in a link
   * such as `/quests?goal=<id>`; `id` above falls back to the goal's place.
   */
  goalId?: string | null;
}

export interface SeasonView {
  name: string;
  /** "9 November 2026 to 21 March 2027", or "" when either end is missing. */
  dates: string;
  goals: SeasonGoalView[];
  /** Which day of the season today is (1-based), or null outside the season or when either end is missing. */
  day: number | null;
  /** How many days the season holds, end day included, or null when either end is missing. */
  of: number | null;
}

const DAY_MS = 86_400_000;
/** "2026-06-21" (or a full ISO stamp) as a UTC civil day number, or null. */
function civilDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null;
}

/** Reads the season state (or a bare season entry). Null when there is no current season. */
export function seasonView(season: unknown, now: Date = new Date()): SeasonView | null {
  const root = season && typeof season === "object" ? (season as Record<string, unknown>) : null;
  const doc = (root && "current" in root ? root.current : root) as Record<string, unknown> | null | undefined;
  if (!doc || typeof doc !== "object") return null;
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  const startsOn = typeof doc.startsOn === "string" ? doc.startsOn : "";
  const endsOn = typeof doc.endsOn === "string" ? doc.endsOn : "";
  const rawGoals = Array.isArray(doc.goals) ? (doc.goals as unknown[]) : [];
  const goals: SeasonGoalView[] = [];
  rawGoals.forEach((g, i) => {
    const o = g && typeof g === "object" ? (g as Record<string, unknown>) : null;
    if (!o || typeof o.text !== "string" || !o.text.trim()) return;
    goals.push({ id: String(o.id ?? i), text: o.text.trim(), done: !!o.done, goalId: typeof o.id === "string" && o.id.trim() ? o.id.trim() : null });
  });
  if (!name && !goals.length) return null;
  const start = civilDay(startsOn);
  const end = civilDay(endsOn);
  const of = start !== null && end !== null && end >= start ? end - start + 1 : null;
  const today = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS);
  const day = of !== null && start !== null && today >= start && today - start < of ? today - start + 1 : null;
  return { name, dates: startsOn && endsOn ? `${civilDayWords(startsOn)} to ${civilDayWords(endsOn)}` : "", goals, day, of };
}
