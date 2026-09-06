-- A TERM ON THE PLANE THAT ACTUALLY CARRIES POWER.
--
-- Two planes shared only a word. Permission roles (`roles`, `role_holders`,
-- from 0002) carry capabilities and had no term column at all. Org-chart seats
-- (`org_role_assignments.term_ends_at`, 0049) carry terms and no capabilities.
-- So a village could write down when somebody's mandate ends and the powers
-- would keep working forever, which is the exact shape of defect this codebase
-- has spent weeks removing: a status saying one thing while the power says
-- another.
--
-- The founder ruled it on 2026-08-31: "No terms should definitely end when
-- they end not with a polite warning! If they're not voted back in then they
-- expire when they expire!" These two columns are what makes that sentence
-- true of the plane that decides what a member may do.
--
-- BOTH ARE NULLABLE, and null is the old behaviour exactly. A holding with no
-- term and no season never lapses, so every row written before today keeps the
-- powers it had. Nothing is revoked by this migration; what it adds is the
-- ability to write a date down and have it mean something.
--
-- `season_id` is the season the holding was made in, so a village whose
-- reassignment cadence is the season turn can end a mandate without anybody
-- having typed a date. It is the same fact `org_role_assignments.season_id`
-- records, kept in the same shape on purpose, because one lapse rule reads
-- both and a second shape would be a second rule.
--
-- EXPAND ONLY. Two ADD COLUMNs, no backfill, no default that rewrites a row.
ALTER TABLE `role_holders` ADD COLUMN `term_ends_at` timestamp NULL;
ALTER TABLE `role_holders` ADD COLUMN `season_id` varchar(64) NULL;

-- The query that matters is "which holdings have run out", asked on the
-- vacancy read and by the term watch. Both scan the whole small table today;
-- the index keeps that honest as a village accumulates seasons of history.
CREATE INDEX `role_holders_term_idx` ON `role_holders` (`term_ends_at`);
