-- 0288: a facilitator fills in for a member.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER.
--
-- WHAT IT HOLDS (Rye, 2026-10-30: "Facilitator can fill other people's stuff
-- out"). In an open Live Session, the person facilitating may fill in what a
-- member would normally fill in themselves: their arrival, an agenda item, an
-- entry (a tension, a proposal, an action), and an action's holder, words and
-- date. Every such write leaves one row here naming BOTH people: who wrote it
-- and whose it is. The room shows "Filled in by the Facilitator" on it, the
-- member hears about it, and the member may undo it while the room is open.
-- A consent answer is never written for anybody, so no row here is ever an
-- answer.
--
--   target     arrival | item | entry
--   target_id  the item or entry id; for an arrival, the person's number
--   act        added (it did not exist before) | changed (it did)
--   before_json  JSON of the fields the write replaced, which is what an undo
--              puts back. NULL for `added`, and emptied by the close: the
--              record keeps who filled in what, and the arrival words go
--              with the rest of the arrival round.
--   noticed_at when the member was told; NULL until the notice went
--   undone_at  when it was undone; an undone row stays as history
--   kept_at    when the person changed it themselves, which makes it theirs:
--              the room stops marking it and it is no longer undone from here
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in every
-- Live Sessions table. 0 means a member who has since left the village.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_on_behalf` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` int NOT NULL,
  -- Who wrote it: the person facilitating at the time.
  `actor_no` int NOT NULL DEFAULT 0,
  -- Whose it is.
  `person_no` int NOT NULL DEFAULT 0,
  `target` varchar(16) NOT NULL,
  `target_id` int NOT NULL DEFAULT 0,
  `act` varchar(8) NOT NULL,
  `before_json` text NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `noticed_at` timestamp NULL DEFAULT NULL,
  `undone_at` timestamp NULL DEFAULT NULL,
  `kept_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `live_session_on_behalf_session_idx` (`session_id`),
  KEY `live_session_on_behalf_person_idx` (`person_no`),
  KEY `live_session_on_behalf_actor_idx` (`actor_no`)
);
