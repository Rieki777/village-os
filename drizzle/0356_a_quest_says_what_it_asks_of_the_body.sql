-- 0343: a physical quest says what it asks of the body, a member says their
-- age band once, and a paid claim says who is paid how.
--
-- WHY (build days, spec internal/spec/build-days US5, US6, R4, R10, R32).
-- Building the village is the most game-like work a village has, and the most
-- dangerous. Skill badges gate tools, heights and machines; a build quest has a
-- minimum age; paid work stays paid. Rye, 2026-11-09: 18, or 16 for light work
-- beside a named adult, never machines or heights; a contractor who has signed
-- the membership agreement earns Voice, one who has not is an outside payee.
--
-- THREE NEW TABLES, NO CHANGE TO ANY EXISTING ONE. The quests and quest_claims
-- write paths are wide and old; putting these facts beside them keeps every
-- existing INSERT and UPDATE byte-identical, so the previous release reads and
-- writes both tables unchanged if it is put back over a migrated database.
--
-- `quest_safety`: one row per quest that asks anything of the body. No row
-- means the quest asks nothing. `required_badges` is a JSON list of badge ids;
-- the claim gate accepts only earned or granted badges, unexpired.
--
-- `member_age_bands`: a BAND, never a birth date ('under16', '16to17',
-- '18plus'). Set once by the member; a later change records who confirmed it.
-- It is personal data: read only by the member and the claim gate, wiped on
-- erasure, included in the member's export.
--
-- `quest_claim_slots`: the pay slot a claim fills on a paid build quest. The
-- approver sets the worker kind and the slot's cash; the claimant never picks
-- them. `payee` is 'member_signed' or 'outside_payee'. A claim with no row here
-- is paid as before, from the quest's own cash.

CREATE TABLE IF NOT EXISTS `quest_safety` (
  `quest_id` varchar(64) NOT NULL,
  `physical` tinyint(1) NOT NULL DEFAULT 0,
  `min_age` smallint NULL,
  `required_badges` json NULL,
  `safety_note` text NULL,
  `estimate_hours` decimal(6,2) NULL,
  `updated_by` varchar(64) NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`quest_id`)
);

CREATE TABLE IF NOT EXISTS `member_age_bands` (
  `user_id` varchar(64) NOT NULL,
  `band` varchar(8) NOT NULL,
  `set_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `changed_by` varchar(64) NULL,
  PRIMARY KEY (`user_id`)
);

CREATE TABLE IF NOT EXISTS `quest_claim_slots` (
  `claim_id` varchar(64) NOT NULL,
  `quest_id` varchar(64) NOT NULL,
  `worker_kind` varchar(24) NOT NULL,
  `cash_minor` bigint NULL,
  `cash_currency` char(3) NULL,
  `payee` varchar(16) NOT NULL,
  `set_by` varchar(64) NOT NULL,
  `set_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`claim_id`),
  KEY `quest_claim_slots_quest_idx` (`quest_id`)
);
