/**
 * This season's goals, each with the village's count of open quests that grow
 * it (`GET /api/quests/goals`, shared/questThreads.ts). `null` while loading;
 * a failed read is an empty list, so a page draws no goal thread rather than
 * a wrong one.
 */
import { useEffect, useState } from "react";
import type { GoalThread } from "@shared/questThreads";

export function useQuestGoals(): GoalThread[] | null {
  const [goals, setGoals] = useState<GoalThread[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/quests/goals")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setGoals(Array.isArray(d?.goals) ? d.goals : []))
      .catch(() => live && setGoals([]));
    return () => {
      live = false;
    };
  }, []);
  return goals;
}
