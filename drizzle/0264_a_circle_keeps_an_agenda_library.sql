-- 0264: a circle keeps an agenda library: what members bring for a session.
--
-- Two new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes either of them, and rolling an image back
-- over a migrated database leaves two tables nobody asks about. No ALTER, no
-- ADD COLUMN, no backfill.
--
-- THE CONTRACT IS shared/sessionLibrary.ts. The statuses, the widths, the
-- rights and every sentence a member reads are named there once; the widths
-- below follow it, and the store cleans and clips to them before an insert.
--
-- WHAT IT HOLDS. A member brings an item for an upcoming session: a title,
-- the aim it needs (the room's own aims) if they know it, a note, and the
-- circle it is for, or none in particular. It waits here until a session takes
-- it up. Opening a room, or the agenda stage of an open room, takes it onto
-- that session's agenda as an ordinary `live_session_items` row. When the
-- session closes, an item the room finished is taken up for good, and one it
-- did not reach comes back to wait for the next session, on its own.
--
-- THE STATE LAYER, the way 0255 keeps the task layer: one row per item with
-- where it stands now (`live_session_library`), and one row per time a session
-- took it (`live_session_library_takes`), settled once when that session
-- closes. The words a closed session wrote down never change: an item's note
-- lands in the room as an ordinary note entry, and the record keeps it as said.
--
-- THE INVARIANTS each transition keeps (server/repos/sessionLibrary.ts writes
-- both tables in one function per move):
--   waiting    session_id and session_item_id NULL, no take with outcome NULL.
--   on_agenda  both set, the session is open, exactly one take with outcome
--              NULL, and that take names the same session and item.
--   taken_up   both set until the session's record is deleted, then NULL.
-- A previous release that closes or deletes a session settles nothing, so the
-- library mends itself where it is read (`reconcileLibrary`).
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in the
-- tables 0238 and 0255 made, and every person column ends in `_no`.
--
-- NO FOREIGN KEYS, the same as every table in this schema. Erasure
-- (`forgetMemberSessions` in server/lib/liveSessions.ts) deletes the rows a
-- leaver brought with every take of them, sets 0 where they took an item, and
-- NULL where they last changed one.
--
-- EVERY DEDUPE COLUMN IS NOT NULL. A MySQL unique index exempts NULLs.

CREATE TABLE IF NOT EXISTS `live_session_library` (
  `id` int NOT NULL AUTO_INCREMENT,
  -- A circle's id, or NULL for an item for no circle in particular.
  `circle_id` varchar(64) NULL,
  -- The same width as an agenda item's title.
  `title` varchar(120) NOT NULL,
  -- report, explore or decide, the room's aims. NULL when the member was not sure.
  `aim` varchar(8) NULL,
  -- Anything the circle should know first, in the member's own words.
  `note` varchar(600) NULL,
  -- Who brought it.
  `brought_by_no` int NOT NULL,
  -- waiting, on_agenda or taken_up.
  `status` varchar(12) NOT NULL DEFAULT 'waiting',
  -- The session it is on now, or was taken up in.
  `session_id` int NULL,
  -- The agenda item it became there.
  `session_item_id` int NULL,
  -- Who last changed its words, when that was somebody else. NULL otherwise.
  `edited_by_no` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set by every write: the column has no ON UPDATE.
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- When it was taken up.
  `settled_at` timestamp NULL,
  PRIMARY KEY (`id`),
  -- What waits, circle by circle, oldest first.
  KEY `live_session_library_wait_idx` (`status`, `circle_id`, `created_at`),
  -- What was taken up lately.
  KEY `live_session_library_settled_idx` (`status`, `settled_at`),
  KEY `live_session_library_session_idx` (`session_id`),
  KEY `live_session_library_brought_idx` (`brought_by_no`)
);

-- Every time a session took an item, and how it left that session.
CREATE TABLE IF NOT EXISTS `live_session_library_takes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `library_id` int NOT NULL,
  `session_id` int NOT NULL,
  -- The live_session_items row it became.
  `item_id` int NOT NULL,
  -- Who put it on that agenda. 0 means a member who has since left the village.
  `taken_by_no` int NOT NULL,
  `taken_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL while the session is open, then taken_up or back.
  `outcome` varchar(12) NULL,
  `settled_at` timestamp NULL,
  PRIMARY KEY (`id`),
  -- ONE TAKE OF AN ITEM PER SESSION. Both columns NOT NULL.
  UNIQUE KEY `live_session_library_takes_uq` (`session_id`, `library_id`),
  KEY `live_session_library_takes_library_idx` (`library_id`, `id`),
  KEY `live_session_library_takes_by_idx` (`taken_by_no`)
);
