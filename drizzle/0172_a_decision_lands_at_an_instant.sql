-- A DECISION LANDS AT AN INSTANT, AND A STEWARD HAS A WINDOW TO STOP IT.
--
-- ── THE RULING THIS SCHEMA CARRIES ──────────────────────────────────────────
--
-- 2026-09-03: "whenever a decision is approved it passes and executes (if it's
-- sending tokens) if it's changing the Game then it starts at the next new moon
-- or automatically if a steward doesn't block it".
--
-- 2026-09-03: "The veto window is 72 hours from the close", with a countdown.
--
-- 2026-09-03: "proposals can each carry - execute at accept or start with the
-- new moon and to default to starting with the new moon".
--
-- So a passed decision is no longer a thing that happened. It is a thing with a
-- date. Two columns hold that date and one holds the act that cancels it.
--
-- ── WHY THE INSTANT AND NOT A CYCLE NUMBER ──────────────────────────────────
--
-- The first plan for this said `lands_at_cycle INT`. A cycle number cannot
-- express a floor of 72 hours: a vote that closes one hour before a new moon
-- and lands "next cycle" gives a steward one hour, which is the exact promise
-- the founder's sentence makes impossible. So both are DATETIME, computed from
-- the ballot's FROZEN `closes_at` and never from the moment a human pressed
-- close. Nobody chooses which three days a steward gets.
--
-- ── WHY `landing_status` IS A SECOND STATUS COLUMN ON `ballots` ─────────────
--
-- `ballots.status` is the OUTCOME of the vote: open, passed, failed, no_quorum,
-- withdrawn. It is read by every payload, every tally and the whole surface,
-- and it must keep meaning exactly that. Landing is a different question asked
-- of a passed row ("has the change gone in yet?"), and the two answers move on
-- different clocks. Folding them into one column would make `status='passed'`
-- stop being true of a landed decision, which every existing selector reads.
--
-- `landing_status` is also the ELECTION. Exactly one executor may run a due
-- row, and it is chosen by a guarded claim:
--
--   UPDATE ballots SET landing_status='applying'
--    WHERE id=? AND status='passed' AND landing_status='pending'
--      AND lands_at <= ? AND vetoed_at IS NULL
--
-- and whoever gets `affectedRows = 1` owns the apply. That is the same shape
-- `closeBallot` already uses for the close, for the same reason: two callers
-- (the five-minute job and a human cycle close) can arrive at one row in the
-- same second, and "read the status then write it" loses that race silently.
--
-- 'not_applicable' is the value for a row that never lands: an advisory vote, a
-- failed vote, a token send that already executed at its close. It is a real
-- answer and never the same fact as 'pending', because a count that cannot tell
-- "nothing to do" from "could not tell" is a count nobody can act on.
--
-- ── THE VETO ────────────────────────────────────────────────────────────────
--
-- `vetoed_at` on the ballot is the gate every apply reads, so a veto is visible
-- to a status-only selector as well as to a join. `vetoed_by` and `veto_reason`
-- sit beside it because a subject with no proposal row (a seat, a power
-- crossing, a launch) still owes the village a name and a sentence. The reason
-- is length-capped in the application layer, stored escaped nowhere and escaped
-- at every render, and redactable: blanking the text leaves the act, the author
-- and the instant standing.
--
-- On `mechanics_proposals` the same five columns carry the same facts for the
-- proposal the village actually reads, plus `supersedes_proposal_id`, which is
-- the veto override: a proposal brought back pointing at the vetoed one and
-- passed again at the village's highest set tier lands regardless of any
-- steward, and the original's veto reason stays visible beside it.
--
-- ── TIMING ──────────────────────────────────────────────────────────────────
--
-- `timing` is the proposer's choice and defaults to 'next_moon', because the
-- founder asked for new activities to start with the moon. It is stored on the
-- proposal (where it is chosen) AND frozen onto the ballot at open (where it
-- decides), the same way method, dials and weights are frozen: a proposal
-- edited after its vote opened must never move the instant the village was
-- shown.
--
-- Expand-only, house rule. Every ALTER here adds; nothing is dropped, nothing
-- is renamed, and every new column is nullable or carries a default, so this
-- file is safe against a table with rows in it.

-- ── ballots ────────────────────────────────────────────────────────────────

ALTER TABLE `ballots` ADD COLUMN `timing` enum('at_acceptance','next_moon') NOT NULL DEFAULT 'next_moon';
ALTER TABLE `ballots` ADD COLUMN `lands_at` datetime NULL;
ALTER TABLE `ballots` ADD COLUMN `veto_closes_at` datetime NULL;
ALTER TABLE `ballots` ADD COLUMN `vetoed_at` datetime NULL;
ALTER TABLE `ballots` ADD COLUMN `vetoed_by` varchar(64) NULL;
ALTER TABLE `ballots` ADD COLUMN `veto_reason` text NULL;
ALTER TABLE `ballots` ADD COLUMN `landing_status`
  enum('not_applicable','pending','applying','applied','vetoed','stalled')
  NOT NULL DEFAULT 'not_applicable';

-- The one index the five-minute job reads. It asks exactly one question, every
-- five minutes, forever: which passed rows are due and not vetoed. Leading with
-- `landing_status` keeps the scan to the handful of rows that are still waiting
-- however many thousand ballots the village has held.
CREATE INDEX `ballots_landing_due_idx` ON `ballots` (`landing_status`, `lands_at`);

-- ── mechanics_proposals ────────────────────────────────────────────────────

ALTER TABLE `mechanics_proposals` ADD COLUMN `timing` enum('at_acceptance','next_moon') NOT NULL DEFAULT 'next_moon';
ALTER TABLE `mechanics_proposals` ADD COLUMN `lands_at` datetime NULL;
ALTER TABLE `mechanics_proposals` ADD COLUMN `veto_closes_at` datetime NULL;
ALTER TABLE `mechanics_proposals` ADD COLUMN `vetoed_at` datetime NULL;
ALTER TABLE `mechanics_proposals` ADD COLUMN `vetoed_by` varchar(64) NULL;
ALTER TABLE `mechanics_proposals` ADD COLUMN `veto_reason` text NULL;
ALTER TABLE `mechanics_proposals` ADD COLUMN `supersedes_proposal_id` varchar(64) NULL;

CREATE INDEX `mechanics_proposals_supersedes_idx` ON `mechanics_proposals` (`supersedes_proposal_id`);

-- 'vetoed' joins the outcome set. A vetoed proposal is not failed (the village
-- said yes) and not applied (nothing went in), and the generated document
-- counts vetoes beside passes and missed quorums because this word exists.
-- Appended to the end of the enum so every stored value keeps its ordinal.
ALTER TABLE `mechanics_proposals` MODIFY `status`
  enum('draft','open','withdrawn','to_hypha','onsite_vote','passed_claimed','passed_verified','passed_onsite','failed','applied','vetoed')
  NOT NULL DEFAULT 'open';
