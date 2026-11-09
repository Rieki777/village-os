-- 0337: what the outside governance service holds, kept whole after each read.
--
-- The structure review compares the service's chart with this village's live
-- chart. A proposal batch cannot do that: it is upserted, it never forgets a
-- record the service dropped, and it says nothing about what the service holds
-- NOW. So each read keeps a snapshot, and the list of differences is computed
-- from the newest snapshots and the live chart at read time.
--
-- WHAT A ROW HOLDS, AND WHAT IT NEVER HOLDS
--
-- Circles and roles only. Tensions, risks and role assignments are never kept
-- here. Each record is the page id, the fields that crossed the boundary in
-- server/lib/saberraRecords.ts read into plain values, members' names swapped
-- out of the prose, and the service's last-edited time when it passed the same
-- door. Never the page address: a page address carries the page title.
--
-- Per kind, `*_read` says whether the kind was read whole or carried the
-- previous snapshot forward, and why: not asked, failed, cut short at the page
-- ceiling, or empty. A carried kind holds the previous records, so a failed
-- read never makes a record look removed.
--
-- The sync keeps the newest 30 rows and deletes older ones itself.
--
-- A new table and nothing else, so the previous release ignores it. No row is
-- seeded, and no user id is stored.

CREATE TABLE IF NOT EXISTS `saberra_snapshots` (
  `seq` bigint NOT NULL AUTO_INCREMENT,
  `taken_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- by-hand or scheduled, the sync log's own words.
  `run_trigger` varchar(16) NOT NULL,
  -- whole, not-asked, failed, cut-short or empty.
  `circles_read` varchar(16) NOT NULL,
  `circles` json NOT NULL,
  `roles_read` varchar(16) NOT NULL,
  `roles` json NOT NULL,
  PRIMARY KEY (`seq`)
);
