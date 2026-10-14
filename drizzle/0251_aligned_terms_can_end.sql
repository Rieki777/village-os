-- 0251: aligned terms can end. Notice, by agreement, superseded, at the term's end, or when a party leaves.
--
-- WHAT THIS IS FOR.
-- Seat settings PR8. A text in the alignment store (0250) comes into force
-- when every required party has aligned with it. This table records how it
-- stops being in force. One row per act or fact, never one row per text:
--
--   notice            a party gives notice; it takes effect `effective_at`,
--                     which is now plus the terms' own notice days
--   notice_withdrawn  the party who gave a notice, or asked to end by
--                     agreement, takes it back before it takes effect;
--                     `refers_to` names the row it cancels
--   mutual            one party asks to end by agreement; the text ends
--                     when every required party has asked
--   superseded        version n+1 of the terms came into force
--   term_end          the term the text ran for reached its end, written on
--                     the day by the hourly alignment sweep for the record
--   party_left        a party left the village
--
-- IN FORCE IS STILL NEVER STORED. It is derived on read: a row that is not
-- withdrawn, whose `effective_at` has passed, ends the text. A withdrawn
-- notice ends nothing. Notice never unseats anybody: a seating ends through
-- the existing doors, and an ended seating ends the terms by the derivation.
--
-- INSERT ONLY, like the four tables of 0250. Nothing updates or deletes a row
-- here, the erasure step included: the rows carry no words, only kinds, ids
-- and instants. The grep test in server/lib/alignments.store.test.ts holds
-- every file to it.
--
-- `party_key` is who acted, as the party they acted for: 'user:<id>' or
-- 'village'. `recorded_by` is the member whose click wrote the row, and null
-- for a row the sweep wrote.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS. One new table. The previous release
-- names it nowhere, so it keeps running if it is put back over a migrated
-- database.

CREATE TABLE IF NOT EXISTS `alignment_endings` (
  -- 'ae-' and sixteen hex characters.
  `id` varchar(40) NOT NULL,
  `text_id` varchar(40) NOT NULL,
  -- notice, notice_withdrawn, superseded, mutual, term_end or party_left.
  `kind` varchar(16) NOT NULL,
  -- For notice_withdrawn, the row it cancels. For superseded, the text that superseded it.
  `refers_to` varchar(40) NULL,
  -- 'user:<id>' or 'village': the party this row acts for. Null for a row the sweep wrote.
  `party_key` varchar(80) NULL,
  `effective_at` datetime(3) NOT NULL,
  `recorded_by` varchar(64) NULL,
  -- Set by the server, to the millisecond, so the rows of one text read in the order they were written.
  `at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `alignment_endings_text_idx` (`text_id`)
);
