-- 0347: a village writes down its cash budget, line by line, every import of it, a note per period, the sources that feed it, and an envelope per circle.
--
-- WHAT THIS IS FOR.
-- Rye, 9 Nov: "build an Admin Budgets upload section, so the Treasurer can
-- upload or update the cash budget." The cash a moon offers on work is a share
-- of the budget left for that moon, and with no budget no cash is offered. So
-- the budget is a record the village keeps, one line per planned amount, and
-- the engine reads one figure for the moon off it (server/lib/budgets.ts,
-- `cashBudgetLeft`). Nothing here moves money and nothing here changes what
-- any work pays in total.
--
-- `budget_lines`, ONE PLANNED AMOUNT.
-- `line_key` is the line's identity across imports, computed in TypeScript
-- (server/lib/budgets.ts, `budgetLineKey`) from the source, the period, the
-- scope, the category and the folded label, or `sera:<source_ref>` for a line
-- the knowledge library sent. It is NOT NULL because a UNIQUE index exempts a
-- NULL, and a nullable dedupe column admits any number of duplicates. It never
-- changes after the line is made, so a hand edit to an uploaded line keeps the
-- key the next upload of the same sheet finds, and the upload leaves the edit
-- alone.
--
-- The period is stored twice on purpose: its kind and key as the person named
-- it (a moon id, a month, a season id, two dates), and its first and last civil
-- day in the village's zone, inclusive, which is what pro-rating reads.
--
-- Every line that counts names a circle or the village-wide scope (budgets
-- spec R34): a line for the whole village holds the fixed marker `@village`,
-- never the circle the `budgets.village_circle_id` dial names today, so moving
-- the dial moves no line, no key and no figure; the circles view puts those
-- lines on the village's circle only when it is read. `circle_id` is NULL only
-- for a line a source sent whose circle this chart does not have: `matched` is
-- false for it, and it never counts. `source_village_wide` marks a source's
-- line that named no circle.
--
-- `withdrawn_by_source` says a withdrawal was an import's (a whole read or a
-- whole upload no longer listing the line), which a later import may undo; a
-- person's withdrawal is never undone by an import. `name_held` keeps a
-- source's line whose words may name a member out of the figure and the
-- member view until a holder renames the words that hold it. `name_held_cell`
-- names those words, one or more of `label`, `source_label` and `note`,
-- comma-separated; `label_override` and `source_label_override` are a holder's
-- renames, and a hold clears only once every cell it names is renamed.
--
-- Money is an integer count of minor units, never negative. `spent_minor` is
-- NULL unless a person typed it or the library sent it.
--
-- A line is withdrawn, never deleted, and can be restored. A line a source
-- sent counts once it is adopted (`adopted_at`, `adopted_as`): by a person,
-- line by line, or at once under the source's standing switch in `auto` mode.
-- `prev_planned_minor` and `prev_seen_at` keep the amount before the last
-- change and when that amount was written, for "was X at the last sync".
--
-- `changed_by` is an account id, de-attributed to NULL when that member is
-- erased; `changed_as` is the role they acted through, or "admin, before
-- launch", and it stays.
--
-- The `fx_` columns are a rate a person locks on a line in another currency
-- (budgets spec 5a, option b): the rate, its source and day, the currency it
-- converts INTO (a rate converts into nothing else), who locked it and the
-- role they locked it as (kept as written, never read back off today's roles).
--
-- `budget_syncs`, ONE ROW PER IMPORT, whatever its source: who, when, through
-- which role, over what scope, and what it added, changed, withdrew and
-- refused. "Last synced" reads the newest row per source. `by` is de-attributed
-- on erasure like `changed_by`. `source_label` names what was imported in the
-- holder's words ("November budget sheet"), checked for names like every
-- budget word; `source_link` is an optional https address of that sheet, which
-- only the people who keep the budget and those who pay cash ever read back.
--
-- `budget_sources`, ONE ROW PER SOURCE THAT FEEDS THE BUDGET (the knowledge
-- library first): whether it is on, whether what it sends counts at once
-- (`auto`) or waits for a person (`review`), how often it is read, and who
-- turned it on and through which role. A source re-checks its setter on every
-- read and turns itself off with `off_reason` when they no longer hold the
-- power. `set_by` is de-attributed on erasure; `set_as` names a role and stays.
-- `on` is a reserved word, so every statement names it in backticks.
--
-- `budget_envelopes`, WHAT A CIRCLE MAY PLAN FOR A PERIOD (R35): one per
-- circle and period, set by the people who keep the budget and read by every
-- member, with a goal note checked for names. A circle's lines are measured
-- against it and a pass warns, never blocks; the moon's figure still counts
-- lines. `changed_by` is de-attributed on erasure.
--
-- `budget_period_notes`, HOW TO READ A PERIOD: one note per period key,
-- written by the people who keep the budget and read by every member.
-- `changed_by` is de-attributed on erasure; `changed_as` names a role and
-- stays.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Five new tables. Nothing the previous release reads or writes changes, so it
-- keeps working if it is put back over a migrated database. The UNIQUE key is on
-- a new table only. No SQL function is called here.

CREATE TABLE IF NOT EXISTS `budget_lines` (
  `id` varchar(64) NOT NULL,
  `line_key` varchar(191) NOT NULL,
  `source` enum('upload','sera','manual') NOT NULL,
  `source_ref` varchar(128) NULL,
  `source_changed_at` timestamp NULL,
  `period_kind` enum('moon','month','season','span') NOT NULL,
  `period_key` varchar(64) NOT NULL,
  `starts_on` date NOT NULL,
  `ends_on` date NOT NULL,
  `circle_id` varchar(64) NULL,
  `role_id` varchar(64) NULL,
  `matched` tinyint(1) NOT NULL DEFAULT 1,
  `source_village_wide` tinyint(1) NOT NULL DEFAULT 0,
  `category` enum('role_pay','quest_pay','materials','other') NOT NULL,
  `planned_minor` bigint NOT NULL,
  `spent_minor` bigint NULL,
  `currency` char(3) NOT NULL,
  `label` varchar(120) NOT NULL,
  `source_label` varchar(120) NULL,
  `note` varchar(500) NULL,
  `status` enum('approved','draft','closed','withdrawn') NOT NULL DEFAULT 'approved',
  `adopted_at` timestamp NULL,
  `adopted_as` varchar(120) NULL,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `changed_by` varchar(64) NULL,
  `changed_as` varchar(120) NULL,
  `fx_rate` decimal(18,8) NULL,
  `fx_source` varchar(120) NULL,
  `fx_as_of` date NULL,
  `fx_locked_by` varchar(64) NULL,
  `fx_locked_at` timestamp NULL,
  `fx_into` char(3) NULL,
  `fx_locked_as` varchar(120) NULL,
  `withdrawn_by_source` tinyint(1) NOT NULL DEFAULT 0,
  `name_held` tinyint(1) NOT NULL DEFAULT 0,
  `name_held_cell` varchar(40) NULL,
  `label_override` varchar(120) NULL,
  `source_label_override` varchar(120) NULL,
  `prev_planned_minor` bigint NULL,
  `prev_seen_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `budget_lines_line_key` (`line_key`),
  KEY `budget_lines_days` (`starts_on`, `ends_on`),
  KEY `budget_lines_status` (`status`, `category`),
  KEY `budget_lines_changed_by` (`changed_by`),
  KEY `budget_lines_fx_locked_by` (`fx_locked_by`)
);

CREATE TABLE IF NOT EXISTS `budget_syncs` (
  `id` varchar(64) NOT NULL,
  `source` enum('upload','sera','manual') NOT NULL,
  `at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `by` varchar(64) NULL,
  `by_as` varchar(120) NULL,
  `scope` json NULL,
  `whole` tinyint(1) NOT NULL DEFAULT 0,
  `lines` int NOT NULL DEFAULT 0,
  `added` int NOT NULL DEFAULT 0,
  `changed` int NOT NULL DEFAULT 0,
  `withdrawn` int NOT NULL DEFAULT 0,
  `refused` int NOT NULL DEFAULT 0,
  `ok` tinyint(1) NOT NULL DEFAULT 0,
  `error` varchar(500) NULL,
  `source_label` varchar(120) NULL,
  `source_link` varchar(500) NULL,
  PRIMARY KEY (`id`),
  KEY `budget_syncs_source_at` (`source`, `at`),
  KEY `budget_syncs_by` (`by`)
);

CREATE TABLE IF NOT EXISTS `budget_sources` (
  `source` varchar(32) NOT NULL,
  `on` tinyint(1) NOT NULL DEFAULT 0,
  `mode` enum('auto','review') NOT NULL DEFAULT 'auto',
  `set_by` varchar(64) NULL,
  `set_as` varchar(120) NULL,
  `set_at` timestamp NULL,
  `off_reason` varchar(500) NULL,
  `schedule` enum('daily','hourly','off') NOT NULL DEFAULT 'daily',
  PRIMARY KEY (`source`),
  KEY `budget_sources_set_by` (`set_by`)
);

CREATE TABLE IF NOT EXISTS `budget_envelopes` (
  `circle_id` varchar(64) NOT NULL,
  `period_kind` enum('moon','month','season','span') NOT NULL,
  `period_key` varchar(64) NOT NULL,
  `starts_on` date NOT NULL,
  `ends_on` date NOT NULL,
  `planned_minor` bigint NOT NULL,
  `currency` char(3) NOT NULL,
  `goal_note` varchar(500) NULL,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `changed_by` varchar(64) NULL,
  `changed_as` varchar(120) NULL,
  PRIMARY KEY (`circle_id`, `period_key`),
  KEY `budget_envelopes_days` (`starts_on`, `ends_on`),
  KEY `budget_envelopes_changed_by` (`changed_by`)
);

CREATE TABLE IF NOT EXISTS `budget_period_notes` (
  `period_key` varchar(64) NOT NULL,
  `note` varchar(1000) NOT NULL,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `changed_by` varchar(64) NULL,
  `changed_as` varchar(120) NULL,
  PRIMARY KEY (`period_key`),
  KEY `budget_period_notes_changed_by` (`changed_by`)
);
