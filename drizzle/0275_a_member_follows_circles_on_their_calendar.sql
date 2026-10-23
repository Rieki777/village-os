-- 0275: a member follows circles on their own calendar.
--
-- Two new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes them, and rolling an image back over a
-- migrated database leaves two tables nobody asks about. No ALTER.
--
-- THE CONTRACT IS shared/sessionCalendar.ts. Every door, limit and sentence a
-- member reads is named there once.
--
-- WHAT IT HOLDS. Which circles' meetings a member follows (each a row, or one
-- row `*` for every circle, the ones still to come included), and the key to
-- their private calendar address. A calendar app (Google, Apple, Outlook)
-- reads the address every few hours and gets the meetings of the circles the
-- member follows at that moment, so a new circle, a changed rhythm or a
-- skipped meeting reaches it without a new address. The meetings themselves
-- are the rhythms of 0271; the village calendar mirrors them too.
--
-- THE KEY IS A CREDENTIAL, so only its sha256 is stored. The key itself is
-- shown to the member once, inside the address, and never again.
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in every
-- Live Sessions table.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_follows` (
  `member_no` int NOT NULL,
  -- A live circle's id, or `*` for every circle, the ones still to come included.
  `circle_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`member_no`, `circle_id`)
);

CREATE TABLE IF NOT EXISTS `live_session_feed_keys` (
  -- One live key per member: a new one takes the place of the old.
  `member_no` int NOT NULL,
  -- sha256 of the key, as hex.
  `key_hash` char(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- When a calendar app last read the address.
  `last_used_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`member_no`),
  UNIQUE KEY `live_session_feed_keys_hash_uq` (`key_hash`)
);
