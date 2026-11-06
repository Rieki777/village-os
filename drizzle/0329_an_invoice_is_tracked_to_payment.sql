-- 0329: an invoice is tracked from sending to payment, and the treasury card syncs (invoice rails, Rye 2026-11-06).
--
-- Four new tables and nothing else, so the previous release ignores them.
-- No row is seeded and nothing is backfilled: the track's sent, approved and
-- paid steps are DERIVED from moon_invoices on every read, so invoices sent
-- before this deploy show their track at once with nothing to copy.
--
-- Every instant here is an ISO 8601 string written by the process, never a
-- database clock, so no read shifts by the database host's offset.
--
-- invoice_mail: the email that carried an invoice to the village's Sera inbox.
-- No body and no attachment is kept, only who, where, when and what became of
-- it. One row per reference and content: the same invoice sent twice is one
-- email, and a changed invoice under the same reference is one more.

CREATE TABLE IF NOT EXISTS `invoice_mail` (
  `id` varchar(64) NOT NULL,
  `invoice_id` varchar(64) NOT NULL,
  `invoice_ref` varchar(80) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `content_hash` varchar(64) NOT NULL,
  `to_email` varchar(254) NOT NULL,
  `status` varchar(16) NOT NULL,
  `message_id` varchar(64) NULL,
  `attempts` int NOT NULL,
  `queued_at` varchar(32) NOT NULL,
  `sent_at` varchar(32) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoice_mail_ref_content_uq` (`invoice_ref`, `content_hash`),
  KEY `invoice_mail_invoice_idx` (`invoice_id`)
);

-- sera_invoice_reports: Sera's own record of an invoice it received, typed
-- fields only (internal contract list_invoices), never prose. Keyed on Sera's
-- id, so a record read twice is one row. A record is attached to one invoice
-- or to none.

CREATE TABLE IF NOT EXISTS `sera_invoice_reports` (
  `sera_id` varchar(120) NOT NULL,
  `reference` varchar(80) NULL,
  `member_code` varchar(64) NULL,
  `moon` varchar(40) NULL,
  `currency` varchar(3) NOT NULL,
  `amount_minor` bigint NOT NULL,
  `status` varchar(16) NOT NULL,
  `received_at` varchar(32) NOT NULL,
  `status_at` varchar(32) NOT NULL,
  `changed_at` varchar(32) NOT NULL,
  `match_state` varchar(16) NOT NULL,
  `matched_invoice_id` varchar(64) NULL,
  `match_by` varchar(16) NULL,
  `first_seen_at` varchar(32) NOT NULL,
  `last_seen_at` varchar(32) NOT NULL,
  PRIMARY KEY (`sera_id`),
  KEY `sera_invoice_reports_invoice_idx` (`matched_invoice_id`),
  KEY `sera_invoice_reports_state_idx` (`match_state`)
);

-- treasury_sync_views: the last reconciled view of one member's treasury card,
-- with each source's state and when it was last read.

CREATE TABLE IF NOT EXISTS `treasury_sync_views` (
  `user_id` varchar(64) NOT NULL,
  `view_json` mediumtext NOT NULL,
  `synced_at` varchar(32) NOT NULL,
  `sync_trigger` varchar(16) NOT NULL,
  PRIMARY KEY (`user_id`)
);

-- treasury_sync_flags: every disagreement a sync found, for the Treasurer.
-- One row per difference (dedupe_key is NOT NULL, so the unique key holds);
-- a later sync that no longer sees it marks it resolved, and keeps the row.

CREATE TABLE IF NOT EXISTS `treasury_sync_flags` (
  `id` varchar(64) NOT NULL,
  `dedupe_key` varchar(191) NOT NULL,
  `user_id` varchar(64) NULL,
  `kind` varchar(32) NOT NULL,
  `subject` varchar(120) NOT NULL,
  `amora_value` varchar(100) NOT NULL,
  `other_value` varchar(100) NOT NULL,
  `first_seen_at` varchar(32) NOT NULL,
  `last_seen_at` varchar(32) NOT NULL,
  `resolved_at` varchar(32) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `treasury_sync_flags_dedupe_uq` (`dedupe_key`),
  KEY `treasury_sync_flags_user_idx` (`user_id`),
  KEY `treasury_sync_flags_open_idx` (`resolved_at`)
);
