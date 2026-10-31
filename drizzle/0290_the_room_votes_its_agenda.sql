-- 0290: the room votes its agenda.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER.
--
-- WHAT IT HOLDS (Rye, 2026-10-30: "In sessions this should be a vote (where
-- we can crowd vote ones up and down and together select the priority)").
-- Everyone in an open Live Session may vote each waiting agenda item up or
-- down: one vote per person per item, which they can change or take back.
-- While the facilitator has not set the order, the agenda sorts itself by the
-- score (ups less downs) every time a vote moves. "Set the order" stops the
-- vote and keeps the order as it stands; the votes stay, as the record of how
-- the room chose.
--
--   vote       1 up, -1 down. Taking a vote back deletes its row, so 0 is
--              never stored.
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in every
-- Live Sessions table. One vote per person per item is the primary key.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_item_votes` (
  `session_id` int NOT NULL,
  `item_id` int NOT NULL,
  `member_no` int NOT NULL,
  `vote` tinyint NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`item_id`, `member_no`),
  KEY `live_session_item_votes_session_idx` (`session_id`),
  KEY `live_session_item_votes_member_idx` (`member_no`)
);
