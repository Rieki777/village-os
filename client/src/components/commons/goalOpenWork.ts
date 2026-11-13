/**
 * OPEN WORK THAT GROWS A GOAL: the village's own count of open quests that
 * serve each season goal, and the door to them on the "Open work" board.
 *
 * Every goal in the commons opens `/quests?goal=<goal id>`, and when the
 * count is known its line says how many open quests grow it ("12 open quests
 * grow Clean water all year"). The count is the village's, summed over every
 * open quest that names the goal. It never says who holds or claimed any of
 * them, and nothing here can carry a personal count.
 *
 * THE READ (lane C5, wired in batch 157).
 *
 * The count comes from the "Open work" board's own read,
 * `GET /api/quests/goals` (`useQuestGoals`, shared/questThreads.ts), which
 * answers each season goal by its 0298 id with the village's count of open
 * quests that grow it. `useGoalOpenWork` turns that list into a map from the
 * goal's id (`SeasonGoalView.goalId`) to the count. While the read is loading
 * it answers `null`, so no count shows; a failed read is an empty map, so no
 * count shows either. Nothing is guessed. The tests in CommonsPanel.test.tsx
 * pass a map directly (`openWork`) and pin the hook against the read.
 */
import { useMemo } from "react";
import type { GoalThread } from "@shared/questThreads";
import { useQuestGoals } from "@/components/openWork/useQuestGoals";

/** Open quests per goal id, the village's own total. Null while the read is unknown. */
export type GoalOpenWork = Readonly<Record<string, number>> | null;

/** The board's goal thread for a goal id. */
export function goalWorkHref(goalId: string): string {
  return `/quests?goal=${encodeURIComponent(goalId)}`;
}

/** The board's per-goal read as a map from goal id to open quests. Null while the read is unknown. */
export function openWorkFromGoals(goals: readonly GoalThread[] | null): GoalOpenWork {
  if (!goals) return null;
  const out: Record<string, number> = {};
  for (const g of goals) {
    if (g && typeof g.id === "string" && g.id && typeof g.openQuests === "number") out[g.id] = g.openQuests;
  }
  return out;
}

/** The village's open quests per season goal, from the "Open work" board's read. */
export function useGoalOpenWork(): GoalOpenWork {
  const goals = useQuestGoals();
  return useMemo(() => openWorkFromGoals(goals), [goals]);
}

/** The count for one goal, or null when the read is unknown, the goal has no id, or the number is not a count. */
export function openWorkFor(work: GoalOpenWork, goalId: string | null | undefined): number | null {
  if (!work || !goalId) return null;
  const n = work[goalId];
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
