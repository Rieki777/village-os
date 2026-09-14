-- A member is vouched into membership by people who already belong.
--
-- Rye's ruling, 2026-09-08. Every member arrives because somebody already here
-- knew them, and whoever invites is vouching. Signing the membership agreement
-- is the member's own half; the village's half is THREE vouches, the inviter's
-- counting as the first. A village therefore cannot start with fewer than
-- three people, which is a true thing about villages and not a limitation.
--
-- WHAT THIS TABLE REFUSES BY SHAPE.
--
-- ONE VOUCH PER PERSON PER PERSON. The unique key is (village, voucher,
-- vouched), so "three vouches" cannot be one enthusiastic neighbour pressing a
-- button three times. Three vouches means three people.
--
-- NO WITHDRAWAL, and this is a governance decision rather than a missing
-- feature (Rye, 2026-09-08). There is no update path and no delete route: a
-- vouch, once given, stands. The alternative hands every member a demotion
-- button over a neighbour, because withdrawing one could drop somebody back
-- below the threshold and out of their own membership. The consequence of a
-- vouch that went badly lands on the VOUCHER instead, which is where the
-- ruling puts it and where a later reputation mechanic can read it from.
--
-- NOBODY VOUCHES FOR THEMSELVES. Enforced in the route rather than here,
-- because MySQL CHECK constraints are not something this runner relies on, and
-- a guard that lives beside the reason it exists is the one that survives.
--
-- `kind` says which act this was: 'arrival' for the inviter's vouch, 'member'
-- for one of the two that follow, and 'super' for a steward's override when a
-- village has lost a voucher and cannot reach three. The column is a varchar
-- and not an enum so a village can grow a fourth kind without a table rebuild,
-- and an unknown value still counts as a vouch, because it is one.
--
-- NO CHARSET OR COLLATE CLAUSE, deliberately. The recent migrations inherit the
-- database's, and `server/db/collation.ts` aligns tables at boot. Pinning one
-- here would put this table in a different collation era from the `users` rows
-- it is joined against, and a cross-era join is the failure that dies off
-- Railway while looking fine on it.
--
-- Expand-only: a new table. The previous release does not know it exists.

CREATE TABLE IF NOT EXISTS `member_vouches` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `voucher_user_id` varchar(64) NOT NULL,
  `vouched_user_id` varchar(64) NOT NULL,
  `kind` varchar(24) NOT NULL DEFAULT 'member',
  `note` varchar(280) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `member_vouches_one_each` (`village_id`, `voucher_user_id`, `vouched_user_id`),
  KEY `member_vouches_vouched_idx` (`village_id`, `vouched_user_id`),
  KEY `member_vouches_voucher_idx` (`village_id`, `voucher_user_id`)
);
