-- 0270: a circle keeps its charter.
--
-- One new table, and one more value on an enum, so this file is expand-only:
-- the previous release neither reads nor writes `circle_charters`, and it never
-- writes the new `update_circle` op, so rolling an image back over a migrated
-- database leaves one table nobody asks about and an enum value nobody uses.
-- No ADD COLUMN on an existing table, no backfill.
--
-- THE CONTRACT IS shared/circleCharter.ts. The fields, their limits and the
-- words a member reads are named there once; the widths below follow it, and
-- the store cleans and clips to them first.
--
-- WHAT IT HOLDS. The words a circle lives by, shaped by the CCOS Circle
-- Charter: why it exists while it does, what it answers for (3 to 6), what it
-- looks after, what it may decide on its own, what it does regularly, how it
-- gives back more than it takes, the tools it relies on, how it keeps power in
-- balance, how a role is handed on, up to two values each with one practice,
-- and an optional short living agreement. The purpose itself stays where it
-- has always been, `circles`.`purpose`.
--
-- WHY A TABLE OF ITS OWN AND NOT COLUMNS ON `circles`. The circles store
-- (`circlesRepo` in server/index.ts) saves by DELETE-all and a re-INSERT of
-- exactly the columns in its spec, and four columns have already been wiped
-- village-wide by being left out of it. These words change only by consent,
-- through an org draft (the `update_circle` op below), so they live where no
-- admin circle edit can reach them.
--
-- ONE ROW PER CIRCLE, written only by a published org draft: absent until the
-- first adoption, and every list column NULL until a draft names it.
-- `last_draft_id` is the draft that last wrote the row.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `circle_charters` (
  -- `circles`.`id`.
  `circle_id` varchar(64) NOT NULL,
  -- "This circle exists while ..."
  `exists_while` varchar(300) NULL,
  -- JSON lists of short lines.
  `accountabilities` json NULL,
  `domains` json NULL,
  `authorities` json NULL,
  `responsibilities` json NULL,
  `stewardship` json NULL,
  `tools` json NULL,
  `checks` json NULL,
  `succession` json NULL,
  -- Up to two { value, practice } pairs.
  `circle_values` json NULL,
  `living_agreement` json NULL,
  `last_draft_id` varchar(64) NULL,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`circle_id`)
);

-- A published org draft is the only writer of the words above.
ALTER TABLE `org_draft_changes`
  MODIFY COLUMN `op` enum('create_seat','create_circle','update_seat','rest_seat','seat_holder','end_holding','move_circle','rest_circle','update_circle') NOT NULL;
