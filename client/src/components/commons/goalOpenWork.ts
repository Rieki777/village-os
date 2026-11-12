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
 * ──────────────────────────────────────────────────────────────────────────
 * SLOT FOR LANE C5 (the "Open work" board with goal threads).
 *
 * The read that counts open quests per goal belongs to C5 and is not on main
 * yet. Until it lands, `useGoalOpenWork` answers `null`: every goal still
 * links to its threads on the board, and no count shows. Nothing is guessed
 * and no endpoint is called.
 *
 * To wire it once C5 lands: fetch C5's read here and answer a map from the
 * goal's own id (`SeasonGoalView.goalId`, the 0298 id) to the number of OPEN
 * quests that grow it, the village's total only. A goal missing from the map
 * shows no count. The tests in CommonsPanel.test.tsx pass a map directly
 * (`openWork`), so they already hold the line's words and the link.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { useState } from "react";

/** Open quests per goal id, the village's own total. Null while the read is unknown. */
export type GoalOpenWork = Readonly<Record<string, number>> | null;

/** The board's goal thread for a goal id. */
export function goalWorkHref(goalId: string): string {
  return `/quests?goal=${encodeURIComponent(goalId)}`;
}

/** SLOT (lane C5): answers null until C5's per-goal open quest count is on main. */
export function useGoalOpenWork(): GoalOpenWork {
  const [work] = useState<GoalOpenWork>(null);
  return work;
}

/** The count for one goal, or null when the read is unknown, the goal has no id, or the number is not a count. */
export function openWorkFor(work: GoalOpenWork, goalId: string | null | undefined): number | null {
  if (!work || !goalId) return null;
  const n = work[goalId];
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
