-- 0383: commitment percent as data (lane E1, the lead 12 Nov 2026).
--
-- Three places now hold a commitment as a number from 1 to 100:
--
--   quests.commitment_pct          how much of a person the quest asks, beside
--                                  the free `duration` words. NULL: not sized.
--   org_roles.commitment_pct       the commitment a role asks, as a stored
--                                  value. NULL: the card falls back to the
--                                  terms on offer (clocks.commitmentPct).
--   org_roles.commitment_required  1 when the role needs the whole of that
--                                  commitment, 0 when it is flexible.
--   member_commitments             what a member says they can give, as a
--                                  dated history. A change is a new row and a
--                                  row is never updated, so the record of
--                                  what someone could give in a season stays.
--
-- Store and display only. Nothing that pays reads any of these; payout use
-- waits for the lead (docs/modules/quests.md).
--
-- EXPAND ONLY. Two nullable columns, one NOT NULL column with a DEFAULT on a
-- table every writer reaches with raw SQL naming its own columns, and one new
-- table. The previous release names none of them, so it keeps reading and
-- writing quests and org_roles unchanged if it is put back over a migrated
-- database.
ALTER TABLE quests ADD COLUMN commitment_pct TINYINT UNSIGNED NULL;

ALTER TABLE org_roles ADD COLUMN commitment_pct TINYINT UNSIGNED NULL;

ALTER TABLE org_roles ADD COLUMN commitment_required TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `member_commitments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(64) NOT NULL,
  `pct` tinyint unsigned NOT NULL,
  `from_date` date NOT NULL,
  `period_kind` varchar(16) NOT NULL,
  `note` varchar(280) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `member_commitments_user_from` (`user_id`, `from_date`, `id`)
);
