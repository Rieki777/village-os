/**
 * THE BACKFILL 0298 USED TO DO IN SQL, AND WHY IT IS HERE INSTEAD.
 *
 * 0298 gave every season goal an id, and gave the links that named a goal by
 * its words the id those words derive. It computed that id in SQL:
 *
 *     CONCAT('g', LEFT(LOWER(SHA1(TRIM(`serves_goal`))), 11))
 *
 * On 2026-11-01 that took Amora down. The deploy carrying 0298 never answered
 * its healthcheck and failed after 15.5 minutes; the Railway log says:
 *
 *     FAIL: 0298_a_season_goal_keeps_its_name.sql
 *       -> FUNCTION railway.SHA1 does not exist (statement 7 of 8)
 *
 * CI applies every migration to mysql:8, where SHA1 is built in, so the whole
 * gate stack was green on a file the production database refuses. The six
 * ALTERs ahead of it had already run, and were recorded in
 * `_migrations_partial` as six statements done.
 *
 * SO THE ALTERS STAYED IN THE MIGRATION AND THE BACKFILL MOVED HERE, where it
 * computes the same id through `goalIdFor` — the function the migration's own
 * header always named as the definition — in Node, on any database.
 *
 * IT IS IDEMPOTENT, BY THE WHERE AND NOT BY A LEDGER. Every UPDATE carries
 * `serves_goal_id IS NULL`, so a row that already has an id is never touched:
 * not on a second boot, not when a member saved the season between the read
 * and the write, and not on an instance that never ran the old statements. It
 * is wired through `runOnce` so a healthy fleet does the work exactly once,
 * but correctness does not depend on that ledger.
 */
import { goalIdFor } from "./seasonGoals";
import { GOAL_LINK_TABLES, goalWordsWithoutIds, writeGoalIdForWords } from "../repos/sessionTemplates";
import type { Queryable } from "../repos/liveSessions";

export interface GoalIdBackfillResult {
  /** Distinct goal texts that needed an id, per table. */
  words: number;
  /** Rows given an id. Zero on every run after the first. */
  rows: number;
}

/**
 * Give every link that names a goal by words alone the id those words derive.
 * Safe to call on any instance, in any state, more than once.
 */
export async function backfillSeasonGoalIds(q: Queryable): Promise<GoalIdBackfillResult> {
  let words = 0;
  let rows = 0;
  for (const table of GOAL_LINK_TABLES) {
    const pending = await goalWordsWithoutIds(q, table);
    for (const row of pending) {
      const text = (row as { serves_goal?: unknown }).serves_goal;
      if (typeof text !== "string" || text.trim() === "") continue;
      words += 1;
      rows += await writeGoalIdForWords(q, table, text, goalIdFor(text));
    }
  }
  return { words, rows };
}

/** The runOnce id, so the ledger entry and the boot call cannot drift apart. */
export const SEASON_GOAL_ID_BACKFILL = "season-goal-ids-0298";
