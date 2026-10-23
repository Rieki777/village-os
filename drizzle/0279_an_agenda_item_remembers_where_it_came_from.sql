-- 0279: an agenda item remembers where it came from.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER.
--
-- THE CONTRACT IS shared/sessionLibrary.ts. Every source and every sentence a
-- member reads about one is named there once.
--
-- WHAT IT HOLDS. Every tension becomes an agenda item. A tension raised with
-- a role, brought to its circle by one of the role's holders, becomes an item
-- waiting for that circle; a tension named in a session's room, sent to a
-- circle's agenda items, becomes an item there. This table says which item
-- came from which tension, so the card can say so and the same tension is
-- never sent twice. A closed session's record is never written to: a room
-- tension that was sent stays as it was, and "From last time" stops offering
-- it because of the row here.
--
--   kind   role_tension  ref = the `role_tensions` id
--          room_tension  ref = the `live_session_entries` id
--
-- ONE ITEM PER TENSION: the unique key on (kind, ref) is the guard, NOT NULL
-- on both, so it holds.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_library_sources` (
  -- The `live_session_library` item.
  `library_id` int NOT NULL,
  `kind` varchar(16) NOT NULL,
  `ref` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`library_id`),
  UNIQUE KEY `live_session_library_sources_ref_uq` (`kind`, `ref`)
);
