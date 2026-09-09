-- ONE EXECUTOR PER DECISION, AND ONE ROW PER THING IT WROTE.
--
-- ── WHY A PENDING TABLE AND NOT A CONSOLE LINE ─────────────────────────────
--
-- The close route closes the ballot with one guarded UPDATE and THEN runs the
-- executor, with no transaction around the pair. An executor that throws lands
-- in the async patch and the 500 handler: the ballot stays closed and passed,
-- the roll is never told, and the only trace is a line in a log nobody reads.
-- The village's decision is then in a state no human can find.
--
-- `governance_executor_pending` is the trace that survives a throw. A row is
-- written the moment an executor is elected and `cleared_at` is stamped when it
-- returns. A row with `claimed_at` set and `cleared_at` null, older than a few
-- minutes, is a decision that started landing and did not finish, and it is
-- readable by a query rather than by grep.
--
-- `attempts` counts elections, so a row that has been picked up repeatedly is
-- visibly different from one that stalled once. `last_error` holds the throw's
-- own words, capped, because "it failed" is not a report anybody can act on.
--
-- The ballot id is the primary key: one decision, one executor, and a second
-- election on the same ballot collides with the first rather than growing a
-- second opinion about which run is the real one.
--
-- ── WHY AN ELEMENT LEDGER ──────────────────────────────────────────────────
--
-- A change set is a list of connected changes that may be of different kinds:
-- a dial, a minting rule, a weight allocation, a module's lifecycle, a brand
-- field, a role. Each kind has its own writer and its own trail table, so
-- "what did this decision actually change?" used to be four joins and a guess
-- about which rows belonged to which vote.
--
-- One row per element per write, keyed on the ballot, answers it in one join.
-- `sentence` is the human line ("the sensing window moved from 7 days to 14"),
-- written by the executor that did the work, because the executor is the only
-- thing that knows what its own write meant.
--
-- `old_value` and `new_value` are REQUIRED of every namespace writer. A ledger
-- that records that something changed without recording what it was before is
-- a ledger nobody can read backwards, and reading backwards is the whole point
-- the day a village asks how it got here.
--
-- `wrote_table` and `wrote_id` point at the row the element actually wrote, so
-- the trail can be walked from the decision to the artifact and back.
--
-- ── WHY THIS IS NOT A TRANSACTION ──────────────────────────────────────────
--
-- Atomicity here comes from PRE-VALIDATION and not from a database
-- transaction, and this comment says so on purpose. The named writers cannot
-- be rolled back as a group: `setVariable` mutates a module-level overrides
-- object, `setWeight` opens its own connection and commits, `setModuleLifecycle`
-- mutates a settings map and reconciles a graph, and the collection writers
-- write through a cache. A rollback would leave the process serving values the
-- database denies until it is restarted, which is worse than the half-apply it
-- was meant to prevent.
--
-- So the executor validates EVERY element first, applies nothing if any element
-- would fail, orders the irreversible writes last, records a row here for each
-- write as it happens, and reloads every written-through cache from the
-- database afterwards. This table is what makes a partial landing legible if
-- one ever happens anyway.
--
-- No FK constraints, house norm.

CREATE TABLE IF NOT EXISTS `governance_executor_pending` (
  `ballot_id` varchar(64) NOT NULL,
  `claimed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cleared_at` timestamp NULL,
  `attempts` int NOT NULL DEFAULT 1,
  `last_error` varchar(1000) NULL,
  PRIMARY KEY (`ballot_id`),
  KEY `governance_executor_pending_open_idx` (`cleared_at`, `claimed_at`)
);

CREATE TABLE IF NOT EXISTS `governance_element_ledger` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ballot_id` varchar(64) NOT NULL,
  `element_index` int NOT NULL,
  `element_kind` varchar(40) NOT NULL,
  `sentence` varchar(1000) NOT NULL,
  `wrote_table` varchar(64) NULL,
  `wrote_id` varchar(128) NULL,
  `old_value` text NULL,
  `new_value` text NULL,
  `applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `governance_element_ledger_ballot_idx` (`ballot_id`, `element_index`),
  KEY `governance_element_ledger_kind_idx` (`element_kind`, `applied_at`)
);
