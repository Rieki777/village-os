-- 0276: a circle consents to a role proposal.
--
-- One new table and one new nullable column, so this file is expand-only: the
-- previous release neither reads nor writes either, and rolling an image back
-- over a migrated database leaves a table and a column nobody asks about.
--
-- THE CONTRACT IS shared/roleProposalConsent.ts. The answers, the window and
-- every sentence a member reads are named there once.
--
-- WHAT IT HOLDS. When a member submits a role proposal (0273), every live
-- holder of a role in the circle or circles the proposed roles sit in, the
-- member themselves excluded, is asked to consent or object within 2 business
-- days on the village's clock. One row per asked holder. `closes_at` is the
-- end of that window, written once at submit for every row of the proposal.
-- `answer` is consent or object, NULL while unanswered; an objection carries
-- its `reason`, and `circle_entry_id` is the tension entry it wrote into the
-- circle's backlog (`live_session_entries`), so the objection reaches the
-- circle's next meeting.
--
-- `role_proposals.decided_words` is the decision record in words, written
-- when the proposal is adopted: "Adopted on 4 Nov after the circle consented",
-- or "Adopted on 4 Nov by the founder's power". It names a role, never a
-- person.
--
-- ERASURE (server/repos/roleProposals.ts `forgetMemberProposals`): a member
-- who leaves is taken off every ask they held, their reasons with them. The
-- decision words are already written, so a decision reads the same after.
--
-- Every instant here is written from Node's clock and read back with
-- UNIX_TIMESTAMP(col), so the database's own zone never moves one.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `role_proposal_asks` (
  `proposal_id` varchar(24) NOT NULL,
  -- The holder asked.
  `user_id` varchar(64) NOT NULL,
  -- The circle they were asked for, the first of theirs the proposal names.
  `circle_id` varchar(64) NOT NULL,
  `asked_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closes_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- consent or object. NULL until answered.
  `answer` varchar(12) NULL,
  `reason` varchar(600) NULL,
  `answered_at` timestamp(3) NULL,
  `circle_entry_id` int NULL,
  PRIMARY KEY (`proposal_id`, `user_id`),
  KEY `role_proposal_asks_holder_idx` (`user_id`, `answer`)
);

ALTER TABLE `role_proposals` ADD COLUMN `decided_words` varchar(200) NULL;
