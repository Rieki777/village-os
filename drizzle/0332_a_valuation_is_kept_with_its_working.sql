-- 0332: the valuation engine keeps its model, and every figure set with it keeps its working.
--
-- WHAT THIS IS FOR.
-- Rye, 2026-11-06: "Role pay is set by both the treasurer and the role/valuation
-- algorithm", with value in equal to value out. The engine (shared/valuationEngine.ts)
-- suggests a total reward price; a person sets the figure (shared/valuationSetting.ts).
-- Two things have to outlive the request: the village's model, version by version,
-- and the record of each figure set beside its suggestion. The gap between the two
-- is what feeds the range back (calibration), and nothing else moves a price.
--
-- `valuation_models`.
-- One row per saved version of the village's model, never edited. `body_json` is
-- the whole model (bands with their sources, levels, the reward rule, the engine's
-- dials). `version` counts up from 1; with no row the engine prices with the
-- platform rules in the village's own currency (version 0). `door` says which door
-- the change came through (version, steward, proposal, vote) and `proposal_ref`
-- the proposal when there was one.
--
-- `valuation_settings`.
-- One row per set act: the work, the frozen inputs and the first suggestion, the
-- figure set, the gap, inside or outside the no-sign band, the reason, who set it,
-- who signed second, and whether Earned Equity was owed rather than paid at the
-- time. `state` moves one way: awaiting_second or awaiting_vote, then set; or
-- straight to set. A row is never deleted: an erased member's id stays, and every
-- reader joins the name, as `cash_owed` (0285) does.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Two new tables, nothing on any existing table. The previous release names
-- neither, so putting it back over a migrated database changes nothing it reads.
-- No SQL function is called.

CREATE TABLE IF NOT EXISTS `valuation_models` (
  `id` varchar(64) NOT NULL,
  `version` int NOT NULL,
  `body_json` json NOT NULL,
  `schema_version` int NOT NULL DEFAULT 1,
  `arithmetic_version` int NOT NULL DEFAULT 1,
  `base_version` int NULL,
  `door` varchar(16) NOT NULL,
  `proposal_ref` varchar(64) NULL,
  `actor_id` varchar(64) NULL,
  `note` varchar(500) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `valuation_models_version` (`version`)
);

CREATE TABLE IF NOT EXISTS `valuation_settings` (
  `id` varchar(64) NOT NULL,
  `work_kind` enum('quest','role','proposal') NOT NULL,
  `work_ref` varchar(64) NOT NULL,
  `category` varchar(100) NOT NULL,
  `state` enum('awaiting_second','awaiting_vote','set') NOT NULL,
  `model_version` int NOT NULL,
  `currency` char(3) NOT NULL,
  `suggested_minor` bigint NOT NULL,
  `range_low_minor` bigint NOT NULL,
  `range_high_minor` bigint NOT NULL,
  `band_low_minor` bigint NOT NULL,
  `band_high_minor` bigint NOT NULL,
  `set_minor` bigint NOT NULL,
  `gap_minor` bigint NOT NULL,
  `inside` tinyint(1) NOT NULL DEFAULT 0,
  `needs` enum('none','second','vote') NOT NULL,
  `reason` varchar(500) NULL,
  `note` varchar(500) NULL,
  `own_number_first` bigint NULL,
  `inputs_json` json NOT NULL,
  `suggestion_json` json NOT NULL,
  `input_changes_json` json NULL,
  `payee_ids_json` json NULL,
  `setter_id` varchar(64) NOT NULL,
  `signer_id` varchar(64) NULL,
  `signed_at` timestamp NULL,
  `conflicted` tinyint(1) NOT NULL DEFAULT 0,
  `ee_held` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `valuation_settings_work` (`work_kind`, `work_ref`, `created_at`),
  KEY `valuation_settings_category` (`category`, `state`),
  KEY `valuation_settings_setter` (`setter_id`, `created_at`)
);
