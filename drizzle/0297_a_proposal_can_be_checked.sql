-- 0297: a proposal in a live session can be checked, and the room sees the read.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release never names it.
--
-- THE CONTRACT IS shared/sessionCheck.ts. One row per checked proposal: a
-- second check replaces the first. The read holds no person (a role's holder
-- is a place, never a name or a number), and the proposal's words are kept
-- only as a hash, so no member's export has a line here. The row goes with
-- its proposal: removing the entry, erasing the member who wrote it and
-- discarding the session each delete it, in the same statements that delete
-- the entry (server/repos/liveSessions.ts).

CREATE TABLE IF NOT EXISTS `live_session_checks` (
  -- The proposal (`live_session_entries`.`id`), one check each.
  `entry_id` int NOT NULL,
  `session_id` int NOT NULL,
  `checked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The sha256 of the proposal's words as checked, so the room sees when they
  -- changed since without this table keeping an earlier draft of them.
  `checked_hash` char(64) NOT NULL,
  -- JSON: the CheckRead.
  `read_json` text NOT NULL,
  PRIMARY KEY (`entry_id`),
  KEY `live_session_checks_session_idx` (`session_id`)
);
