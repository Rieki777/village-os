-- 0217: a proposal says what it serves, and the answer stays on the record.
--
-- Rye, 2026-09-23, on what it means that every later change is judged against
-- the village's governing purpose statement: THE PROPOSER WRITES A LINE. On a
-- proposal that changes how the village works, the proposer writes one line
-- saying how it serves the purpose; the line shows beside the proposal while
-- people vote, and it STAYS ON THE RECORD.
--
-- WHY THE COLUMN IS ON THE BALLOT AND NOT ONLY ON THE PROPOSAL, and there are
-- two independent reasons, either of which would be enough on its own:
--
--   1. "Stays on the record" is the ruling's own phrase. A ballot is the row
--      this codebase keeps forever: it freezes its method, its dials, its
--      electorate and its weights at open, and every later read goes to the
--      ballot and never to the live settings. A proposal can be withdrawn,
--      rewritten and resubmitted. The judgement the village actually voted
--      under is the one frozen beside the vote.
--   2. The Saberra module's own `Purpose Alignment` field sits on their
--      DECISIONS record, and a ballot is what a decision is here. Keeping the
--      two on the same kind of row, under the same name, is what stops the two
--      systems growing separate answers to one question.
--
-- THE NAME IS `purpose_alignment` EXACTLY, for the same reason. Their field
-- and ours are the same field, and a mapping that has to translate a name is a
-- mapping somebody eventually gets backwards.
--
-- WHICH BALLOTS CARRY ONE is decided in code and not here, because it is a
-- rule and rules move: `PURPOSE_ALIGNMENT_SUBJECTS` in
-- shared/governingPurpose.ts names mechanics, power_transfer, power_grant,
-- power_return and gps_change, and nothing else. The scoping is part of the
-- ruling: Rye chose against a field on every proposal, because a field on
-- every proposal becomes a ritual people fill with "it does", which looks
-- like judgement happened when it did not.
--
-- EXPAND, NEVER CONTRACT: one nullable column on a populated table. Every
-- ballot opened before this release has no line and NULL is the honest value
-- for that, since nobody was asked. The previous release names no column
-- outside its own SELECT list on this table and inserts an explicit column
-- list, so it keeps reading and writing `ballots` unchanged if this release is
-- rolled back over an already-migrated database.
--
-- NULL AND NOT AN EMPTY-STRING DEFAULT, deliberately. An empty string would
-- say the proposer was asked and wrote nothing, and a ballot from 2026-08
-- was never asked at all. Those are different facts and a surface reading the
-- column has to be able to tell them apart.
--
-- No index. Nothing queries by this column: it is read with the ballot it
-- belongs to, by primary key, on the one page that renders it.

ALTER TABLE `ballots`
  ADD COLUMN `purpose_alignment` text NULL;

-- ── AND THE STATEMENT A CHANGE BALLOT IS ASKING FOR ─────────────────────────
--
-- The same shape as `role_declarations` (0120) and for the same reason: a
-- ceremony's payload is a row keyed by its ballot, never a passage parsed back
-- out of the document. The document is what the village READS, written for
-- people, and a closer that recovered the new statement by finding a heading
-- in markdown would break the day somebody improved the wording of a heading.
--
-- ONE ROW PER BALLOT. `ballots.open_key` is unique while open and a change
-- ballot's subject ref is the constant `statement`, so at most one change can
-- be running at a time and the primary key here says the same thing from the
-- other side.
--
-- NO FOREIGN KEY, matching 0120 and the table this platform's migration rules
-- allow: a new FOREIGN KEY on an existing table is on the never list, and a
-- ballot row is never deleted anyway.
--
-- EXPAND, NEVER CONTRACT: a new table, created IF NOT EXISTS. The previous
-- release does not know it exists and neither reads nor writes it.

CREATE TABLE IF NOT EXISTS `gps_change_proposals` (
  `ballot_id` varchar(40) NOT NULL,
  `statement` text NOT NULL,
  `proposed_by` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ballot_id`)
) ENGINE=InnoDB;
