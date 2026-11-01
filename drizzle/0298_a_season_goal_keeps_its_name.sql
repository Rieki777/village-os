-- 0298: a season goal keeps its name, a tension can be told apart or joined,
-- and a win on an agenda item serves the season too.
--
-- New nullable columns, one new column NOT NULL with a DEFAULT on a table the
-- previous release writes only through an INSERT that names its columns (so
-- the default applies), and a backfill with a WHERE. No new table, no index,
-- nothing dropped or narrowed: expand-only. The previous release names none of
-- these columns and never reads them.
--
-- THE CONTRACT IS shared/sessionTemplates.ts ("The season") and
-- server/lib/seasonGoals.ts.
--
-- SERVES_GOAL_ID. Every season goal now carries an id (the season document,
-- app_config "season"), so a weekly priority, a win in a meeting and a win on
-- an agenda item name the goal they serve by id and stay linked when the goal
-- is reworded. `serves_goal` keeps the words as they were when linked, so a
-- link to a goal that was removed still says what it served.
--
-- THE BACKFILL. A goal written before ids existed is given the id its words
-- derive: `g` and the first eleven hex digits of the SHA-1 of its trimmed text
-- (`goalIdFor` in server/lib/seasonGoals.ts computes the same). Every link made
-- by words before this file gets the same id here, so a link and its goal agree
-- before anybody saves the season again. Two goals on one season with the same
-- words derive the same base id, and the second takes `-2`; a link made by
-- words named the first, so it lands on the first, the same goal the words
-- found before.
--
-- SAME_AS_ID AND STANDS_ALONE. Telling a tension that keeps coming up from a
-- new one is a guess from shared words, and people know better: anybody who
-- was in both Heart shares can say two tensions are the same one, and anybody
-- who was in one can say it stands alone, which keeps the guess away from it.

ALTER TABLE `live_session_priorities` ADD COLUMN `serves_goal_id` varchar(40) NULL;

ALTER TABLE `live_session_shares` ADD COLUMN `serves_goal_id` varchar(40) NULL;

ALTER TABLE `live_session_shares` ADD COLUMN `same_as_id` int NULL;

ALTER TABLE `live_session_shares` ADD COLUMN `stands_alone` tinyint NOT NULL DEFAULT 0;

ALTER TABLE `live_session_entries` ADD COLUMN `serves_goal_id` varchar(40) NULL;

ALTER TABLE `live_session_entries` ADD COLUMN `serves_goal` varchar(200) NULL;

-- THE BACKFILL IS NOT HERE ANY MORE, AND THAT IS WHAT THIS FILE IS ABOUT.
--
-- Statements 7 and 8 of this file used to compute the derived id in SQL:
--
--     CONCAT('g', LEFT(LOWER(SHA1(TRIM(`serves_goal`))), 11))
--
-- On 2026-11-01 that took Amora down. The deploy carrying this file failed
-- after 15.5 minutes and the Railway log says why, exactly:
--
--     FAIL: 0298_a_season_goal_keeps_its_name.sql
--       -> FUNCTION railway.SHA1 does not exist (statement 7 of 8)
--
-- CI runs migrations against mysql:8, which has SHA1 built in, so every gate
-- in the repository was green on a file the production database refuses. SHA1
-- is the ONLY function name in all 214 migrations that had never run on
-- production before this one; the other 52 are portable by proof, having each
-- already executed there. scripts/check-migration-sql.mjs now holds that list
-- and refuses a new name, so the next unportable function is a red CI run
-- rather than a failed deploy.
--
-- SO THE SIX STATEMENTS ABOVE ARE BYTE IDENTICAL TO WHAT RAN, and the backfill
-- moved to TypeScript: `backfillSeasonGoalIds` (server/lib/seasonGoalIds.ts),
-- run once at boot, computing the same id through `goalIdFor` and idempotent,
-- so it is safe on an instance that never saw the old statements at all.
--
-- WHY SHRINKING THIS FILE IS SAFE RATHER THAN A SECOND MIGRATION. Production
-- holds this filename in `_migrations_partial` with `statements_done` = 6 and
-- NOT in `_migrations_applied`. server/db/migrate.ts resumes at
-- `Math.min(progress, parts.length)`, which is now min(6, 6) = 6: the loop
-- body never runs, nothing is replayed, the file is recorded applied and its
-- partial row is deleted. An instance that never ran it gets six ALTERs. The
-- checksum tamper guard compares APPLIED rows only, and this file is not one.
-- server/db/migrateShrink.test.ts proves both paths on a real database.
