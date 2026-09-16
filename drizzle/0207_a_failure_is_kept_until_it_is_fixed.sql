-- 0207: a failure is kept until it is fixed.
--
-- WHY THIS TABLE EXISTS
--
-- Rye's ruling, 2026-09-14: "all failed actions should have a single job that
-- reruns failed actions and creates a report for us to know why things are
-- failing and what needs to be fixed for us to act on."
--
-- Before this, most failures in the platform were recorded nowhere, or recorded
-- where nobody reads them. `scheduled_jobs.last_result` is overwritten every
-- run. `governance_executor_pending` and `integration_health` keep failures in
-- rows that nothing gathers into one place. A payment that failed to settle
-- leaves a row in `payments_log` and nothing that says whether it ever healed.
-- The job in server/lib/failedActions.ts reads each of those places every hour
-- and writes what it finds HERE, so there is one list a founder can open.
--
-- ONE ROW PER THING THAT IS FAILING, NEVER ONE PER RUN
--
-- (`source`, `item_key`) is the thing. `first_seen_at` answers "failing since
-- when", set back to when the failure began whenever the source knows.
-- `last_seen_at` is when a run last confirmed it, and `resolved_at` when a run
-- stopped finding it. A row per run would grow by hundreds an hour and still
-- could not say how long anything had been broken.
--
-- EPISODES AND NOTICES
--
-- A thing that breaks again after being fixed reopens its own row as a new
-- episode, and `episode` counts them. `notified_at` is when the last notice
-- carried the row, and `notified_episode` is which episode that notice was
-- about. A counter, because a timestamp holds whole seconds and a reopen can
-- land in the same second as a notice, where no comparison of the two can say
-- which came first. A reopen never erases `notified_at`, so the day's record of
-- having sent a notice survives it.
--
-- `quiet_seconds` is how long the row may be open before a notice mentions it.
-- It lives on the row so that a run which cannot read the row's area still
-- honours it.
--
-- `item_key` IS OPAQUE AND NEVER A PERSON
--
-- Never a member id, a name, an email or an inbox id. The erasure sweep does not
-- scrub this table, so a key naming a departed member would outlive their
-- erasure. Unfinished erasures appear as counts, the same rule the erasure queue
-- at /review already keeps.
--
-- `last_error` IS KEPT ONLY WHILE THE ROW IS OPEN
--
-- It copies the failing system's own words, and a vendor's error or a thrown
-- message can say anything. The job clears it on the run that finds the failure
-- gone, and deletes a resolved row after thirty days.
--
-- NO CHARSET OR COLLATE CLAUSE, deliberately: the table inherits the database's,
-- and `server/db/collation.ts` aligns tables at boot. Nothing joins this table
-- to another.
--
-- THE INDEX ON `payments_log`
--
-- Every hour the report asks whether a later delivery settled each order that
-- failed to settle. Without an index on the order, that is a scan of the whole
-- log for every failed delivery, and the log gains a row for every webhook.
--
-- Expand-only: a new table and a new non-unique index. The previous release
-- neither reads nor writes the table, and an index changes no query's answer.

CREATE TABLE IF NOT EXISTS `failed_action_items` (
  `source` varchar(48) NOT NULL,
  `item_key` varchar(128) NOT NULL,
  `title` varchar(255) NOT NULL,
  `advice` varchar(600) NOT NULL,
  `last_error` varchar(500) NULL,
  `first_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `episode` int NOT NULL DEFAULT 1,
  `quiet_seconds` int NOT NULL DEFAULT 0,
  `resolved_at` timestamp NULL,
  `notified_at` timestamp NULL,
  `notified_episode` int NULL,
  PRIMARY KEY (`source`, `item_key`),
  KEY `failed_action_items_open_idx` (`resolved_at`, `source`)
);

ALTER TABLE `payments_log` ADD KEY `payments_log_order_idx` (`module`, `order_id`);
