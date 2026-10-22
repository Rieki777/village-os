-- 0267: a member's season plan carries their own words, and each moon its load.
--
-- WHAT THIS IS FOR.
-- The player role card (PR 6 of 7). On Your season a member ticks every
-- village goal they serve, with a "How it helps" line under each; sets one to
-- three bigger goals of their own for the whole season; and writes how they
-- hold their roles, in six short answers, for the card. Each moon they also
-- say how the moon feels, from Healthy to Heavy. Rules and limits live in
-- shared/seasonPlanWords.ts.
--
-- THREE NULLABLE COLUMNS ON `season_plans` (0258).
-- `serves_goals_json`: [{"goal","howItHelps"}], each goal one of the season's
-- goals as written, at most as many as the season holds. `serves_goal` keeps
-- being written as the first of them, so the previous release still reads a
-- plan. NULL on a row the previous release wrote: the reader then serves that
-- one goal with no "How it helps" line.
-- `seasonal_goals_json`: zero to three {"title","doneWhen"}.
-- `card_words_json`: {"howIHold","findMe","decisions","feedback",
-- "growingEdge","nextHolder"}, each at most 300 characters.
-- The version-insert rule is unchanged: a save inserts version n+1 with every
-- column, and the erasure step nulls all three for a member who leaves.
--
-- ONE NEW TABLE, `player_moon_load`.
-- One row per member per moon, `level` 1 (Healthy) to 5 (Heavy), the
-- member's own read. The primary key is the member and the moon, and a second
-- read the same moon replaces the first (INSERT ... ON DUPLICATE KEY UPDATE,
-- server/repos/seasonPlans.ts): the card shows this moon's read only, so a
-- history of changed minds would be kept for nobody. The erasure step deletes
-- a departed member's rows.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Three nullable columns with no default, and a new table. The previous
-- release names none of them: its INSERT leaves them NULL and its reads skip
-- them, so it keeps reading and writing plans unchanged over a migrated
-- database.

ALTER TABLE `season_plans`
  ADD COLUMN `serves_goals_json` json NULL,
  ADD COLUMN `seasonal_goals_json` json NULL,
  ADD COLUMN `card_words_json` json NULL;

CREATE TABLE IF NOT EXISTS `player_moon_load` (
  `user_id` varchar(64) NOT NULL,
  -- The village clock's id for the moon, `idFor(now)`.
  `cycle_id` varchar(64) NOT NULL,
  -- 1 is Healthy, 5 is Heavy.
  `level` tinyint NOT NULL,
  `set_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `cycle_id`)
);
