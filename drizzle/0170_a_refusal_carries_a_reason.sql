-- A VETO IS A FIRST-CLASS ACT, AND IT CARRIES A REASON.
--
-- The founder settled the reason on 2026-08-31: "Yes a steward veto absolutely
-- should carry a reason." He settled the shape of the act on 2026-09-03: the
-- steward does not approve anything. A decision the village carried lands on
-- its own, and the seat's one power is to stop it inside the window before it
-- lands, in the open, with a name and a reason on the record.
--
-- This file first shipped as `ballot_approvals`, a one-row-per-ballot approval
-- record with an `approved` / `refused` enum. That model was withdrawn before
-- it ran anywhere, so the table is written here as the thing it should have
-- been rather than migrated into it later. Nothing outside this build has ever
-- created the old table.
--
-- ── WHY THE KEY IS (ballot, steward, act) AND NOT THE BALLOT ────────────────
--
-- A village may turn on `governance.steward_council`, under which a veto needs
-- a MAJORITY of the seated stewards rather than any one of them. Under an
-- approval model one row per ballot was right, because one approval was the
-- whole answer. Under a council a ballot collects one act per steward, so the
-- ballot alone cannot be the key without throwing away the second steward's
-- act, and `stewardVetoStands` would have nothing to count.
--
-- The unique key carries `act` as well, so one steward may record an early
-- "no objection" and still veto later inside the window without either row
-- overwriting the other. Both acts stay readable, which is the honest record:
-- a steward who looked, said nothing was wrong, then saw something, is a fact
-- the village should be able to read.
--
-- Both routes stay retry-safe on that key with
-- `INSERT ... ON DUPLICATE KEY UPDATE id = id`, so a double-tapped veto writes
-- one row and reads the standing one back.
--
-- ── THE REASON IS PUBLIC, PERMANENT, AND REDACTABLE ────────────────────────
--
-- `reason` IS NOT NULL. A veto with no reason is a proposal dying quietly,
-- which is the exact defect the requirement exists to close. It is plain text,
-- length-capped by the writer at 2000 characters, and escaped by every
-- renderer: it is free text one member writes about another member's work on
-- a page the whole village reads.
--
-- Because it is free text about a named neighbour it also has to be erasable
-- without erasing the act. `redacted_at` and `redacted_by` are how: redaction
-- blanks the words and keeps the veto, its author and its instant, so the
-- record still says that this decision was stopped, by this person, at this
-- time. A deleted row would say the decision was never stopped at all.
--
-- No FK constraints, house norm. `decided_by` is a user id and stays readable
-- after the account is gone, because the record is the village's.
CREATE TABLE IF NOT EXISTS `ballot_vetoes` (
  `id` varchar(64) NOT NULL,
  `ballot_id` varchar(64) NOT NULL,
  `act` enum('veto','no_objection') NOT NULL,
  `decided_by` varchar(64) NOT NULL,
  `reason` text NOT NULL,
  `redacted_at` timestamp NULL,
  `redacted_by` varchar(64) NULL,
  `decided_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ballot_vetoes_one_act_idx` (`ballot_id`, `decided_by`, `act`),
  KEY `ballot_vetoes_ballot_idx` (`ballot_id`, `act`),
  KEY `ballot_vetoes_by_idx` (`decided_by`)
);
