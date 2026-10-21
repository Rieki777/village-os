-- 0238: a circle holds a live session, and keeps its record.
--
-- Six new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes any of them, and rolling an image back over
-- a migrated database leaves six tables nobody asks about.
--
-- THE CONTRACT IS shared/sessions.ts. The stages, the aims, the entry kinds,
-- the consent values and every limit are named there once; the widths below
-- follow its SESSION_LIMITS, and the store cleans and clips to them before an
-- insert, because strict MySQL refuses an over-long field and a member would
-- lose every word.
--
-- A PERSON HERE IS A NUMBER. The room's wire shapes carry people as numbers
-- (a round's speaking order, an action's owner, the facilitator), and a
-- member's own id in this village is a string. `live_session_members` gives
-- each member who ever joins a session one number, and every person column in
-- the other five tables holds that number. The columns end in `_no` so nobody
-- joins one to `users`.`id` by mistake: MySQL compares a string to an int by
-- casting the string, and every member id would cast to 0.
--
-- THE PRIVACY LINE, which every column below follows:
--   - Members only. No row is written for anybody who is not signed in.
--   - The arrival round stays in the room. `arrival_score` and `arrival_wish`
--     are set to NULL for everybody at close, after the spread (count,
--     median, low, high) is written into `live_sessions`.`summary`.
--   - Feedback on the facilitation is a response row with its member's number
--     so one person answers once. No route returns that number with it.
--   - The record of a closed session is read by its people and by admins.
--   - Nothing here is written to `health_events`, which defaults to a public
--     audience.
--
-- NO FOREIGN KEYS, the same as every table in this schema. Erasure runs after
-- the tombstone (`forgetMemberSessions` in server/lib/liveSessions.ts): it
-- deletes the member's people rows, responses and the entries they wrote,
-- clears them off the actions they held, sets 0 where they facilitated, took
-- notes or opened a session, rebuilds the stored minutes of every closed
-- session that named them, and then deletes their number.
--
-- EVERY DEDUPE COLUMN IS NOT NULL. A MySQL unique index exempts NULLs.

CREATE TABLE IF NOT EXISTS `live_session_members` (
  `no` int NOT NULL AUTO_INCREMENT,
  -- `users`.`id`. One number per member, for good.
  `user_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`no`),
  UNIQUE KEY `live_session_members_user_uq` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `live_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(120) NOT NULL,
  -- A circle's id, or NULL for a session that belongs to no circle.
  `circle_id` varchar(64) NULL,
  -- open or closed.
  `status` varchar(12) NOT NULL DEFAULT 'open',
  -- People are numbers from `live_session_members`. 0 means a member who has
  -- since left the village.
  `facilitator_no` int NOT NULL,
  `secretary_no` int NULL,
  `created_by_no` int NOT NULL,
  `duration_min` smallint NOT NULL,
  -- JSON: the room's SessionState, which the facilitator moves.
  `state` text NOT NULL,
  -- Goes up by one on every write, in the same transaction. The room's ETag.
  `version` int NOT NULL DEFAULT 1,
  -- JSON: the SessionStamp taken at start (moon, season, place line).
  `stamp` text NOT NULL,
  -- JSON, at close: the arrival spread, the tallies of every proposal and a
  -- few counts. Numbers only.
  `summary` text NULL,
  -- The minutes as markdown, written at close, in the two audiences.
  `minutes_people` mediumtext NULL,
  `minutes_shareable` mediumtext NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  -- The list: what is open now, newest first.
  KEY `live_sessions_status_idx` (`status`, `created_at`),
  -- The last closed session of a circle, for what carries over.
  KEY `live_sessions_circle_idx` (`circle_id`, `closed_at`)
);

CREATE TABLE IF NOT EXISTS `live_session_people` (
  `session_id` int NOT NULL,
  `member_no` int NOT NULL,
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The last time this person's page said it was still here.
  `last_seen_at` timestamp NULL,
  -- 1 to 11, while the session is open. NULL for everybody after close.
  `arrival_score` tinyint NULL,
  -- What would make it an 11+, while open. NULL for everybody after close.
  `arrival_wish` varchar(200) NULL,
  PRIMARY KEY (`session_id`, `member_no`),
  KEY `live_session_people_member_idx` (`member_no`)
);

CREATE TABLE IF NOT EXISTS `live_session_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` int NOT NULL,
  `title` varchar(120) NOT NULL,
  -- report, explore or decide.
  `aim` varchar(8) NOT NULL,
  `minutes` smallint NOT NULL,
  `position` int NOT NULL,
  -- waiting, active, done or parked.
  `status` varchar(12) NOT NULL DEFAULT 'waiting',
  `added_by_no` int NOT NULL,
  `presenter_no` int NULL,
  -- When it last became the active item, and when it last stopped being it.
  `started_at` timestamp NULL,
  `ended_at` timestamp NULL,
  -- Every second it has been active, across every time it was.
  `used_seconds` int NOT NULL DEFAULT 0,
  -- The closed session of the same circle it was brought over from.
  `from_session_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `live_session_items_session_idx` (`session_id`, `position`)
);

CREATE TABLE IF NOT EXISTS `live_session_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` int NOT NULL,
  -- The agenda item it belongs to, or NULL for the session as a whole.
  `item_id` int NULL,
  -- note, idea, seed, decision, action or tension.
  `kind` varchar(12) NOT NULL,
  `text` varchar(600) NOT NULL,
  -- open, done or parked.
  `status` varchar(12) NOT NULL DEFAULT 'open',
  `author_no` int NOT NULL,
  -- Who holds an action: a person, a seat (`org_roles`.`id`), or both.
  `owner_no` int NULL,
  `owner_seat_id` varchar(64) NULL,
  `due_on` date NULL,
  `claimed_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `live_session_entries_session_idx` (`session_id`, `item_id`),
  KEY `live_session_entries_author_idx` (`author_no`),
  KEY `live_session_entries_owner_idx` (`owner_no`)
);

CREATE TABLE IF NOT EXISTS `live_session_responses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` int NOT NULL,
  -- agenda, decision:<entry id>, word or facilitation.
  `target` varchar(40) NOT NULL,
  `member_no` int NOT NULL,
  `value` varchar(32) NOT NULL,
  `text` varchar(600) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- ONE ANSWER PER PERSON PER TARGET, changeable while the session is open.
  UNIQUE KEY `live_session_responses_uq` (`session_id`, `target`, `member_no`),
  KEY `live_session_responses_member_idx` (`member_no`)
);
