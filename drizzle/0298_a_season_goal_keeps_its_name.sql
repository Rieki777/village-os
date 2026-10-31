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

UPDATE `live_session_priorities` SET `serves_goal_id` = CONCAT('g', LEFT(LOWER(SHA1(TRIM(`serves_goal`))), 11)) WHERE `serves_goal_id` IS NULL AND `serves_goal` IS NOT NULL AND `serves_goal` <> '';

UPDATE `live_session_shares` SET `serves_goal_id` = CONCAT('g', LEFT(LOWER(SHA1(TRIM(`serves_goal`))), 11)) WHERE `serves_goal_id` IS NULL AND `serves_goal` IS NOT NULL AND `serves_goal` <> '';
