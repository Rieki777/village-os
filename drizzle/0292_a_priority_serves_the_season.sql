-- 0292: a weekly priority, and a win, name the season priority they serve.
--
-- Two nullable columns on two tables 0291 made, and nothing else, so this file
-- is expand-only: the previous release names neither column, never reads them,
-- and an INSERT that leaves them out writes NULL, which reads as "serves no
-- season priority".
--
-- THE CONTRACT IS shared/sessionTemplates.ts ("Serving the season").
--
-- WHAT IT HOLDS. One of the season's own goals (the `goals` list on the season
-- in the app_config "season" document), COPIED AS WRITTEN, the same way
-- `season_plans`.`serves_goal` names the goal a member's plan serves. The
-- season's goals carry no id, so the words are the reference.

ALTER TABLE `live_session_priorities` ADD COLUMN `serves_goal` varchar(200) NULL;

ALTER TABLE `live_session_shares` ADD COLUMN `serves_goal` varchar(200) NULL;
