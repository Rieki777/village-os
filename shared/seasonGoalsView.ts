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
}

export interface SeasonView {
  name: string;
  /** "9 November 2026 to 21 March 2027", or "" when either end is missing. */
  dates: string;
  goals: SeasonGoalView[];
}

/** Reads the season state (or a bare season entry). Null when there is no current season. */
export function seasonView(season: unknown): SeasonView | null {
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
    goals.push({ id: String(o.id ?? i), text: o.text.trim(), done: !!o.done });
  });
  if (!name && !goals.length) return null;
  return { name, dates: startsOn && endsOn ? `${civilDayWords(startsOn)} to ${civilDayWords(endsOn)}` : "", goals };
}
