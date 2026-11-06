-- 0333: Funding rounds. The village chooses which proposed quests to fund
-- within a pot (Rye, 2026-11-06, relayed by the master coordinator).
--
-- A pot is money set aside for the village to decide on, in any unit: a
-- currency code or a registered token id, never hardcoded. A round runs four
-- stages over a pot (seed, grow, choose, harvest), and its stage is DERIVED
-- from its dates, so a round whose grow date is NULL stays in seed until
-- somebody sets one. Ideas are proposed quests; at harvest a funded idea
-- becomes a quest through the same path the admin form uses, and holds an
-- EARMARK on the pot. Cash is paid only when the quest's completion is
-- consented, through cash_owed, so nothing is paid in advance and nothing
-- ever returns: an earmark is held, owed, paid or released.
--
-- interaction_events is a platform spine (Rye, 2026-11-06): every member act
-- a later reward rule may read, holding references and never content. Rows
-- for an anonymous idea's author are `private`. Erasure deletes a member's
-- private rows and de-attributes the rest (server/lib/erasure.ts).
--
-- New tables only, so the previous release ignores them. Raw SQL through
-- server/repos/fundingRounds.ts, no dbCollection: no column relies on a
-- DEFAULT reaching a write it did not name.

CREATE TABLE IF NOT EXISTS `funding_pots` (
  `id` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL,
  `purpose` text NULL,
  `kind` enum('season','rolling') NOT NULL DEFAULT 'season',
  -- A currency code (CRC) or a token id. Never hardcoded in the platform.
  `unit_kind` enum('currency','token') NOT NULL DEFAULT 'currency',
  `unit_code` varchar(64) NOT NULL,
  -- NULL means whoever holds pot.steward; a role id hands one pot to that role.
  `holder_role_id` varchar(64) NULL,
  `circle_id` varchar(64) NULL,
  -- The pot's home on the map, as its creator chose it.
  `structure_key` varchar(128) NULL,
  `clock` enum('lunar','seasonal','fixed') NOT NULL DEFAULT 'seasonal',
  -- Which count decides. 'people' until the counted-Voice guardrails land.
  `decider` enum('power','people') NOT NULL DEFAULT 'people',
  `weight_cap_pct` int NOT NULL DEFAULT 25,
  `counted_voice` enum('work_only','all') NOT NULL DEFAULT 'work_only',
  `status` enum('open','paused','closed') NOT NULL DEFAULT 'open',
  `created_by` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- Money received into a pot, recorded by a cash.pay holder. The pot's
-- balance is the sum of these, minus what its earmarks paid.
CREATE TABLE IF NOT EXISTS `funding_pot_receipts` (
  `id` varchar(64) NOT NULL,
  `pot_id` varchar(64) NOT NULL,
  `amount_minor` bigint NOT NULL,
  `note` varchar(255) NULL,
  `recorded_by` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `funding_pot_receipts_pot_idx` (`pot_id`)
);

CREATE TABLE IF NOT EXISTS `funding_rounds` (
  `id` varchar(64) NOT NULL,
  `pot_id` varchar(64) NOT NULL,
  `title` varchar(160) NOT NULL,
  -- The stage is derived from these. A NULL later date holds the round in the
  -- stage before it: grow_at NULL keeps the round in seed.
  `seed_at` datetime NOT NULL,
  `grow_at` datetime NULL,
  `choose_at` datetime NULL,
  `harvest_at` datetime NULL,
  `offered_minor` bigint NULL,
  `rubric` json NULL,
  `quorum_pct` int NOT NULL DEFAULT 40,
  `ideas_per_member` int NOT NULL DEFAULT 2,
  `anonymous_allowed` tinyint(1) NOT NULL DEFAULT 1,
  -- Frozen when choosing opens; NULL until then.
  `decider` enum('power','people') NULL,
  `weight_cap_pct` int NULL,
  `counted_voice` enum('work_only','all') NULL,
  -- Both counts, the divergence and the steps, written once at harvest.
  `outcome` json NULL,
  `closed_at` datetime NULL,
  `created_by` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `funding_rounds_pot_idx` (`pot_id`)
);

CREATE TABLE IF NOT EXISTS `funding_round_ideas` (
  `id` varchar(64) NOT NULL,
  `round_id` varchar(64) NOT NULL,
  -- Always the real author, kept for erasure and abuse handling. No screen
  -- shows it when shown_as is 'anonymous'.
  `author_id` varchar(64) NOT NULL,
  `shown_as` enum('named','anonymous') NOT NULL DEFAULT 'named',
  `title` varchar(160) NOT NULL,
  `what` text NOT NULL,
  `who_helps` text NULL,
  `rough_cost_minor` bigint NULL,
  `who_might` text NULL,
  `structure_key` varchar(128) NULL,
  `circle_id` varchar(64) NULL,
  `locale` varchar(16) NULL,
  `status` enum('seed','grown','on_ballot','funded','not_funded','withdrawn','held','stopped') NOT NULL DEFAULT 'seed',
  -- Grow: the shaped quest.
  `deliverable` text NULL,
  `ask_minor` bigint NULL,
  `shared_impact` tinyint(1) NOT NULL DEFAULT 0,
  `thread_id` varchar(64) NULL,
  `quest_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `funding_round_ideas_round_idx` (`round_id`),
  KEY `funding_round_ideas_author_idx` (`author_id`)
);

-- Approval ticks during choose: one row per member per idea they would fund.
CREATE TABLE IF NOT EXISTS `funding_round_marks` (
  `round_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`round_id`, `user_id`, `idea_id`),
  KEY `funding_round_marks_user_idx` (`user_id`)
);

-- An earmark is a funded quest's claim on its pot. held + owed + paid never
-- exceeds what the pot received (checked in the same transaction as every
-- new earmark). Released is final for that earmark; its amount is free again.
CREATE TABLE IF NOT EXISTS `funding_earmarks` (
  `id` varchar(64) NOT NULL,
  `pot_id` varchar(64) NOT NULL,
  `round_id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `quest_id` varchar(64) NULL,
  `amount_minor` bigint NOT NULL,
  `status` enum('held','owed','paid','released') NOT NULL DEFAULT 'held',
  `expires_on` date NULL,
  `released_reason` varchar(255) NULL,
  `changed_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `funding_earmarks_pot_idx` (`pot_id`, `status`),
  KEY `funding_earmarks_quest_idx` (`quest_id`)
);

CREATE TABLE IF NOT EXISTS `interaction_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `occurred_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL after erasure: the row keeps its kind and time, de-attributed.
  `actor_user_id` varchar(64) NULL,
  `kind` varchar(64) NOT NULL,
  `subject_type` varchar(32) NOT NULL,
  `subject_ref` varchar(64) NOT NULL,
  `round_id` varchar(64) NULL,
  `visibility` enum('public','members','private') NOT NULL DEFAULT 'members',
  `channel` enum('web','map','bot','api') NOT NULL DEFAULT 'web',
  -- NOT NULL and unique: a retried write is a no-op.
  `dedupe_key` varchar(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `interaction_events_dedupe_uq` (`dedupe_key`),
  KEY `interaction_events_actor_idx` (`actor_user_id`),
  KEY `interaction_events_subject_idx` (`subject_type`, `subject_ref`)
);
