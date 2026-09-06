-- THE LANDING LOOP NAMES ITS OWN ROWS: every status it uses, every row it must
-- reach, and one key per element it wrote.
--
-- ── WHAT THE SECOND AUDIT FOUND, AND WHAT THIS FIXES ────────────────────────
--
-- Migration 0172 gave `ballots` a landing status and a landing instant. Four
-- things were still missing and each one is a decision that quietly never
-- happens.
--
-- 1. ROWS ALREADY RESTING WITH NO INSTANT. Before the veto window existed, a
--    carried change set was parked at `passed_verified` or `passed_onsite` and
--    applied by an inline block inside the admin cycle close. That block is
--    gone, and its rows have a NULL `lands_at`, so the new landing gate cannot
--    see them and, after the Game starts, neither can the now-refused admin
--    apply route. They are stranded. The backfill at the bottom gives every one
--    of them an instant, and the instant is IN THE FUTURE by the floor of the
--    veto window, so a steward gets the notice the ruling promises rather than
--    watching a backlog land in one sweep.
--
-- 2. A ROW THAT NEVER LANDS AND NEVER FAILS. `landing_status` had no word for
--    a decision that carried and then sat through cycle after cycle without
--    landing. `expired` is that word: after `governance.landing_expiry_cycles`
--    boundaries the row closes with one door, withdraw and rewrite, which
--    carries the backers. `stall_reopens` counts the windows a stalled row has
--    been given back, so a brake that keeps going off cannot hand the same
--    decision an endless countdown.
--
-- 3. A WINDOW THAT WAS OVER BEFORE IT OPENED. `lands_at` is derived from the
--    ballot's frozen `closes_at`, which is what stops a proposer choosing which
--    three days a steward gets. It also means any delay longer than the window
--    between `closes_at` and the actual close produces a row whose window has
--    already shut at the moment stewards are told it began. `late_settled_at`
--    and `late_settled_reason` record the restamp, so the record says the
--    window was recounted rather than claiming it was honoured.
--
-- 4. A DECISION NOBODY MAY STOP, WITH ITS WINDOW INTACT. Section 20.11: an edit
--    to `governance.steward_subjects`, `steward_council` or `veto_hours` keeps
--    its timing and its window like any Game change and is NOT vetoable.
--    `veto_locked` is that fact, stamped at the close by the same arithmetic
--    that stamps the instant, so the veto route and every surface read one
--    answer instead of recomputing it from the change set.
--
-- ── THE TWO TABLES 0173 KEYED WRONG ────────────────────────────────────────
--
-- `governance_element_ledger` keyed on an autoincrement id with a plain index
-- on (ballot_id, element_index), so a retried landing could write a second row
-- for the same element and the trail would say the dial moved twice. The key is
-- the pair, which makes the write idempotent per element and lets 21.2's
-- reversion join it. `proposal_id` sits beside `ballot_id` for the same join.
--
-- `governance_executor_pending` keyed on the ballot and upserted, so a second
-- attempt OVERWROTE the failure the table exists to record. It takes its own
-- id: one row per attempt, the earlier rows keeping their `last_error`.
--
-- Both tables were created in this same wave and have never run outside it, so
-- the two re-keying statements below land beside their own creation rather than
-- over a released schema. Everything else here is additive.

ALTER TABLE `ballots` ADD COLUMN `veto_locked` tinyint NOT NULL DEFAULT 0;
ALTER TABLE `ballots` ADD COLUMN `late_settled_at` datetime NULL;
ALTER TABLE `ballots` ADD COLUMN `late_settled_reason` varchar(1000) NULL;
ALTER TABLE `ballots` ADD COLUMN `stall_reopens` int NOT NULL DEFAULT 0;

ALTER TABLE `ballots` MODIFY `landing_status`
  enum('not_applicable','pending','applying','applied','vetoed','stalled','expired')
  NOT NULL DEFAULT 'not_applicable';

-- The relation is EXPLICIT. `supersedes_proposal_id` alone conferred
-- steward-proof landing on anything that pointed at a vetoed row, and three
-- different writers set that column: an override, a renewal of an expiring
-- setting, and the withdraw-and-rewrite clone. Only one of those is the village
-- answering a veto at the highest bar it has set for itself.
ALTER TABLE `mechanics_proposals` ADD COLUMN `supersedes_relation`
  enum('renews','overrides','replaces') NULL;

ALTER TABLE `governance_element_ledger` ADD COLUMN `proposal_id` varchar(64) NULL;
-- Where the write fell in the executor's own order, which is the order that
-- puts the harder-to-undo writes last. `element_index` is the order a MEMBER
-- read ("item 2 of 4"); the two are different facts and both are needed, and
-- the autoincrement id below was quietly doing the second job until now.
ALTER TABLE `governance_element_ledger` ADD COLUMN `write_seq` int NOT NULL DEFAULT 0;
-- DEDUPE BEFORE THE KEY, and the reason is that the key is over exactly the
-- rows the defect above was able to write. A retried landing wrote a second row
-- for the same element; ADD PRIMARY KEY over two such rows does not warn, it
-- REFUSES with a duplicate-entry error, and a refusing migration is a village
-- that cannot boot.
-- The header argues no instance can hold those rows, because both tables were
-- created in this same unreleased wave. That is true today and it is an
-- assumption with an expiry date: it stops being true the moment the wave
-- ships, and any developer or test database that ran the wave and retried a
-- landing already holds them now. One statement removes the dependence on it.
-- The keeper is the HIGHEST id, which is the most recent write and therefore
-- the one describing the element's final state. It has to run before the
-- DROP COLUMN below, because `id` is what picks the winner.
DELETE `l` FROM `governance_element_ledger` `l`
  JOIN `governance_element_ledger` `keep`
    ON `keep`.`ballot_id` = `l`.`ballot_id`
   AND `keep`.`element_index` = `l`.`element_index`
   AND `keep`.`id` > `l`.`id`;
ALTER TABLE `governance_element_ledger`
  DROP PRIMARY KEY,
  DROP COLUMN `id`,
  ADD PRIMARY KEY (`ballot_id`, `element_index`);

ALTER TABLE `governance_executor_pending`
  DROP PRIMARY KEY,
  ADD COLUMN `id` bigint NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`id`),
  ADD KEY `governance_executor_pending_ballot_idx` (`ballot_id`, `claimed_at`);

-- ── THE BACKFILL ───────────────────────────────────────────────────────────
--
-- Every ballot whose proposal is still resting at `passed_verified` or
-- `passed_onsite` with no landing instant. The instant is now plus the floor of
-- the veto window, so the window a steward gets is the one the ruling promises
-- and a village coming back to a backlog watches it land one window from now
-- rather than all at once. `WHERE` on every clause: nothing already stamped,
-- nothing already vetoed, nothing that never lands.
UPDATE `ballots` b
  JOIN `mechanics_proposals` p ON p.id = b.subject_ref
-- UTC_TIMESTAMP, NEVER NOW. `lands_at` is a plain DATETIME with no timezone
-- conversion of its own, and every other writer of it puts a UTC instant there
-- (`sqlInstant` is `toISOString`). `NOW()` returns the SERVER's local time, so
-- on any database not running at UTC this backfill stamps a window short or
-- long by the server's offset, and the steward's 72 hours quietly becomes 65 or
-- 79. It reads correct on a UTC CI box, which is what makes it worth naming
-- here: the one machine that would have caught it is the one that cannot.
  SET b.lands_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR),
      b.veto_closes_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR),
      b.landing_status = 'pending'
  WHERE b.subject_type IN ('mechanics','mint_rule')
    AND b.status = 'passed'
    AND b.lands_at IS NULL
    AND b.vetoed_at IS NULL
    AND p.status IN ('passed_verified','passed_onsite');

UPDATE `mechanics_proposals` p
  JOIN `ballots` b ON b.subject_ref = p.id AND b.subject_type IN ('mechanics','mint_rule')
  SET p.lands_at = b.lands_at,
      p.veto_closes_at = b.veto_closes_at
  WHERE p.status IN ('passed_verified','passed_onsite')
    AND p.lands_at IS NULL
    AND b.lands_at IS NOT NULL;

-- ── ONE DIGEST PER CYCLE ───────────────────────────────────────────────────
--
-- The cycle id is the PRIMARY KEY and the insert is the claim: whoever writes
-- the row composes the digest, and every other caller for that cycle posts
-- nothing. Two ticks at one boundary, two servers, and a human cycle close
-- arriving in the same second all reduce to one feed item.
--
-- `posted_at` stays NULL when the row was written and the feed item was not,
-- which is the one failure this shape can have and the one a human can find.
CREATE TABLE IF NOT EXISTS `governance_moon_digests` (
  `cycle_id` varchar(64) NOT NULL,
  `ended_at` datetime NOT NULL,
  `composed_at` datetime NOT NULL,
  `posted_at` datetime NULL,
  `body` mediumtext NOT NULL,
  PRIMARY KEY (`cycle_id`),
  KEY `governance_moon_digests_ended_idx` (`ended_at`)
);
