-- Every seat has a term, and by default it ends with the season.
-- Rulings of 2026-09-13 and 2026-09-14; the rules live in shared/seatTerms.ts.
--
-- Expand only. Three new columns on existing tables, each nullable or NOT NULL
-- with a DEFAULT, so the previous release keeps reading and writing every row.
--
-- ballots: a seat vote freezes its term when it opens, the same way it freezes
-- its electorate. The closer seats with THIS term, re-read from the season only
-- when the vote asked for the season's end and the season has moved since.
ALTER TABLE `ballots` ADD COLUMN `seat_term_ends_at` datetime NULL;
ALTER TABLE `ballots` ADD COLUMN `seat_term_season_id` varchar(64) NULL;
ALTER TABLE `ballots` ADD COLUMN `seat_term_follows_season` tinyint NOT NULL DEFAULT 0;
--
-- The two seat planes. A holding that follows its season is restamped when an
-- admin moves that season's end. Default 0 means a row the previous release
-- writes keeps its own date, which is the safe direction.
ALTER TABLE `role_holders` ADD COLUMN `term_follows_season` tinyint NOT NULL DEFAULT 0;
ALTER TABLE `org_role_assignments` ADD COLUMN `term_follows_season` tinyint NOT NULL DEFAULT 0;
