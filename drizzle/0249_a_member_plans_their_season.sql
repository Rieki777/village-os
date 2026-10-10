-- 0249: each member plans their season.
--
-- WHAT THIS IS FOR.
-- Season plans RC1 (2026-10-09), "Your season". At the start of each season
-- every member says which seats they keep, hand back or apply for, and what
-- they personally commit to: an aim, a season goal they serve, quests a moon
-- and up to three measures (shared/seasonPlans.ts). A seat that needs the
-- village's word is an ordinary `seat_applications` row (0248), found by
-- `candidate_user_id` and `term_season_id`; this table holds no second copy.
-- What a member commits to personally is FILED, never voted.
--
-- ONE ROW PER VERSION, INSERTED.
-- A save inserts version n+1 and stamps `superseded_at` on the version before
-- it. Filing stamps `filed_at` on a version. Nothing else is ever updated,
-- except the erasure step, which sets `aim`, `serves_goal` and
-- `commitments_json` to NULL for a member who leaves. Raw SQL only
-- (server/repos/seasonPlans.ts), never `dbCollection`, whose `replaceAll`
-- resets omitted columns.
--
-- NO MONEY.
-- `commitments_json` holds the seat settings `quests` and `scoreboard` groups
-- and nothing else. Terms, money included, live on the application.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- One new table. The previous release neither reads nor writes it.

CREATE TABLE IF NOT EXISTS `season_plans` (
  -- 'sp-' and sixteen hex characters.
  `id` varchar(40) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `season_id` varchar(64) NOT NULL,
  `version` int NOT NULL,
  -- What the member sets out to do this season, at most 600 characters.
  `aim` varchar(600) NULL,
  -- One of the season's goals, copied as written.
  `serves_goal` varchar(200) NULL,
  -- JSON: the `quests` and `scoreboard` groups of shared/seatSettings.ts.
  `commitments_json` json NULL,
  -- JSON: the org seat ids the member hands back at the turn.
  `handing_back` json NULL,
  `filed_at` datetime NULL,
  `superseded_at` datetime NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `season_plans_version_uq` (`user_id`, `season_id`, `version`),
  KEY `season_plans_season_idx` (`season_id`)
);
