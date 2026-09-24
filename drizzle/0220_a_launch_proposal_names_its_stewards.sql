-- 0220: the launch proposal NAMES the founding stewards, and each of them
-- answers for themselves.
--
-- Rye, 2026-09-24, choosing between two designs: "is whoever is clicking the
-- 'launch village' button then selects from a list of members in the proposal
-- to carry the steward role so then it's there in the proposal to be voted on.
-- I like this second route better". Asked who may be named and what happens to
-- somebody who does not want it: "founders only for this first season (after
-- that anyone can raise their hand for a steward role and fill it if voted
-- in), and show the declines".
--
-- So a launch ballot carries a SLATE, and this table is it: one row per person
-- the proposal names, frozen to the ballot the way `ballot_electorate` freezes
-- the roll.
--
-- ── WHY A TABLE AND NOT A COLUMN ───────────────────────────────────────────
--
-- The slate is a LIST of members, and a list of members belongs in rows.
-- `ballot_electorate` is the same shape for the same reason and is the
-- precedent this file copies down to the column widths: `varchar(40)` for the
-- ballot and `varchar(64)` for the member, `ENGINE=InnoDB` with no CHARSET
-- clause so a fork cannot end up with one half of a join in a different
-- collation from the other. A JSON column on `ballots` would have been a
-- second encoding of "these members", unjoinable to the vote rows the seating
-- has to intersect it with.
--
-- ── WHAT THE ACCEPTANCE IS, AND WHY IT IS NOT IN THIS TABLE ────────────────
--
-- `ballot_votes.stands_for_steward` (0218) already exists and CHANGES MEANING
-- with this file. It meant "I volunteer for the seat". It now means "I ACCEPT
-- THE NOMINATION THIS PROPOSAL MADE OF ME", and it is only meaningful for
-- somebody who is on the slate: the seating intersects the two, so a member
-- who is not named and sets the flag anyway is not seated by it. That is
-- asserted by name rather than left as a reading of the SQL, in
-- `server/stewardSlate.db.test.ts`.
--
-- Keeping the acceptance on the vote row is deliberate. Accepting is part of
-- answering the ballot: you read the proposal that names you, and you say yes
-- to the village and yes to the seat in one act. The row already freezes when
-- the ballot closes, already carries the UNIQUE key that makes a second
-- thought a rewrite, and is already as unforgeable as the record of who voted
-- yes. A second acceptance column here would be a second home for one fact.
--
-- ── THE DECLINE IS HERE, AND IT HAS TO BE ──────────────────────────────────
--
-- `stands_for_steward` is `TINYINT(1) NOT NULL DEFAULT 0`, so 0 cannot tell
-- "said no" apart from "has not answered yet", and Rye asked for the declines
-- to be SHOWN. A decline also has to be sayable by somebody who has not voted:
-- `ballot_votes.choice` is NOT NULL, so there is no row to carry it until they
-- do, and being named for nineteen powers you do not want is exactly the state
-- somebody should be able to answer straight away.
--
-- So the nomination's refusal lives on the nomination's own row. `declined_at`
-- NULL means the answer has not been given; a value means it was no, and when
-- it was. The route that writes it also clears `stands_for_steward`, and the
-- seating refuses anybody carrying a decline even if the flag were somehow
-- set, which is the fail-safe direction: never seat somebody who said no.
--
-- ── EXPAND-ONLY, AND THE ROLLBACK IS A NO-OP ───────────────────────────────
--
-- One new table, `CREATE TABLE IF NOT EXISTS`, no `ALTER`, no index on an
-- existing table, no foreign key. The previous release neither reads nor
-- writes it, so putting the old image back leaves the rows sitting there
-- harmlessly and a re-deploy picks them up again. Replaying the file is a
-- no-op for the same reason the six replay-safe economics migrations were:
-- `IF NOT EXISTS` is the whole statement.
--
-- No foreign key on purpose, the same posture `ballot_electorate` and
-- `ballot_votes` take: this schema carries none on the ballot tables, and
-- adding one only here would make this table the one that refuses a write the
-- others accept.
--
-- ── WHAT AN ALREADY-OPEN LAUNCH VOTE READS AS ──────────────────────────────
--
-- An empty slate, which seats nobody. A village mid-launch when this lands
-- therefore starts its Game with the seat empty and is told so in words, and
-- fills it through an ordinary `role_seat` ballot. That is the same safe
-- direction 0218 chose: nobody is handed a power they never asked for.

CREATE TABLE IF NOT EXISTS `ballot_steward_slate` (
  `ballot_id` varchar(40) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  -- Who put this person on the slate. One person chooses it, so the page that
  -- shows the slate can say whose choice it was.
  `proposed_by` varchar(64) NOT NULL,
  -- NULL until they say no. A value is a decline, and when.
  `declined_at` datetime NULL DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ballot_id`, `user_id`)
) ENGINE=InnoDB;
