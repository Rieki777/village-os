-- 0322: holding a seat grants its Power groups (Rye, 2026-11-01).
--
-- 0049 built the org chart and deliberately left the bridge unbuilt: a seat
-- carried accountabilities and no permissions. This is the bridge. One row
-- says "whoever holds this org seat, right now, holds this Power group".
--
-- Nothing is copied into role_holders. The holding is DERIVED on every read
-- (server/lib/seatGrants.ts), so a power ends the moment the seating ends,
-- lapses, or the person leaves, with nothing to sweep.
--
-- A new table and nothing else, so the previous release ignores it. No row is
-- seeded: no seat gains a power until somebody links it, so this deploy
-- changes nobody's powers.
--
-- Raw SQL, not a dbCollection, for the reason 0049 gives: no replaceAll.

CREATE TABLE IF NOT EXISTS `org_role_power_groups` (
  `org_role_id` varchar(64) NOT NULL,
  `role_id` varchar(64) NOT NULL,
  `created_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`org_role_id`, `role_id`),
  KEY `org_role_power_groups_role_idx` (`role_id`)
);
