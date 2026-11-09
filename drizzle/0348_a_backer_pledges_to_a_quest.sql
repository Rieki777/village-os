-- 0348: Backing pledges on Funding rounds quests (plan section 18; Rye,
-- 2026-11-06 and 2026-11-08, relayed by the master coordinator).
--
-- Any member may back a proposed quest at any stage with a pledge in the
-- pot's unit, shown openly with their name. A pledge can be withdrawn until
-- the round's choosing closes, and a withdrawal stays on the record. When
-- choosing closes, the standing pledges on the ballot turn FIRM: the count
-- then asks the pot only for the quest's ask minus its firm pledges, and the
-- earmark holds that remainder. A pledge made in harvest on a funded quest is
-- firm at once and lowers its earmark. Pledges on an idea that was not funded
-- go back to the backer.
--
-- No money moves through this table yet. Collecting a firm pledge waits on
-- Rye's answer to Q-B1, and equity on consented completion goes through the
-- economics lane's issueInvestment with ref pledge:<id> (equity_posted_ref).
--
-- Exactly one of idea_id or pot_id is set. Pot pledges arrive with the
-- Treasurer's board; this slice writes quest pledges only.
--
-- A new table only, so the previous release ignores it. Raw SQL through
-- server/repos/fundingRounds.ts, and every INSERT names every column.

CREATE TABLE IF NOT EXISTS `funding_pledges` (
  `id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NULL,
  `pot_id` varchar(64) NULL,
  -- The real backer. Erasure deletes a pledge that never turned firm and
  -- keeps a firm one, de-attributed, because a promise of money outlives
  -- the account (Rye, 2026-10-31: debts outlive erasure).
  `backer_user_id` varchar(64) NOT NULL,
  `amount_minor` bigint NOT NULL,
  `unit_code` varchar(64) NOT NULL,
  `stage_at_pledge` enum('seed','grow','choose','harvest','after') NOT NULL,
  `status` enum('pledged','withdrawn','firm','collected','paid','released_to_backer','moved_to_pot') NOT NULL,
  `on_abandon` enum('return','pot') NOT NULL DEFAULT 'return',
  -- The backing rate printed on the pledge when equity is wired; NULL until then.
  `rate_frozen` json NULL,
  `equity_posted_ref` varchar(128) NULL,
  `badge_awarded_at` datetime NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `firm_at` datetime NULL,
  `withdrawn_at` datetime NULL,
  `collected_at` datetime NULL,
  `paid_at` datetime NULL,
  `released_at` datetime NULL,
  PRIMARY KEY (`id`),
  KEY `funding_pledges_idea_idx` (`idea_id`, `status`),
  KEY `funding_pledges_pot_idx` (`pot_id`),
  KEY `funding_pledges_backer_idx` (`backer_user_id`)
);
