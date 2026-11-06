-- The end-of-moon review (module moon-review, ships off).
--
-- Once a moon a member who holds a seat sends a RECAP of what they delivered,
-- read against their role cards and the season goals, and, when a seat's
-- adopted terms carry money, a DRAFT INVOICE for approval. Two different
-- people approve, neither of them the member: whoever holds moon.approve
-- approves the work, then a cash.pay holder approves the invoice. The
-- platform records money and never moves it. Pay is for deliverables: no
-- column in these tables carries hours or minutes.
--
-- moon_recaps: one row per member per moon (cycle_id is the id the village
-- clock gives the moon, the same id the cash owed role key uses). Statuses
-- are varchar on purpose, never ENUM, so a later status is a code change.
--
-- moon_recap_items: one row per piece of work. dedupe_key is NOT NULL, since
-- a NULL would slip past the unique key: task:<member task id>,
-- sera:<external id>, room:<entry id>, hand:<id>. One piece of work never
-- arrives twice in one recap.
--
-- moon_invoices: the draft invoice a member sends. bill_ref_seq is the payer's
-- own sequence, assigned at send inside one transaction. revision lets a void
-- invoice be followed by a new one for the same moon and payer.
--
-- member_pay_routes: the member's own declaration of how they are paid. No
-- tax id, no document number, no bank details. Read by the member and by
-- cash.pay holders only.
--
-- moon_review_events: append-only. Never updated, never deleted, including on
-- erasure (amounts, dates, numbers and events stay; text is cleared).
--
-- Member-pii: every text column naming or describing a member is cleared on
-- erasure by the sweep in server/repos/moonRecaps.ts.
--
-- Expand only: five new tables. Nothing dropped or renamed.

CREATE TABLE IF NOT EXISTS `moon_recaps` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `cycle_id` varchar(32) NOT NULL,
  `season_id` varchar(64) NULL,
  `status` varchar(24) NOT NULL DEFAULT 'draft',
  `round` int NOT NULL DEFAULT 0,
  `own_words` text NULL,
  `role_audit_json` text NULL,
  `work_approved_at` timestamp NULL,
  `work_approved_by` varchar(64) NULL,
  `finance_approved_at` timestamp NULL,
  `finance_approved_by` varchar(64) NULL,
  `approval_hash` varchar(64) NULL,
  `returned_note` text NULL,
  `returned_by` varchar(64) NULL,
  `returned_at` timestamp NULL,
  `sent_at` timestamp NULL,
  `sera_state` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `moon_recaps_member_cycle` (`user_id`, `cycle_id`),
  KEY `moon_recaps_cycle_status` (`cycle_id`, `status`)
);

CREATE TABLE IF NOT EXISTS `moon_recap_items` (
  `id` varchar(64) NOT NULL,
  `recap_id` varchar(64) NOT NULL,
  `origin` varchar(8) NOT NULL,
  `dedupe_key` varchar(160) NOT NULL,
  `text` varchar(500) NOT NULL,
  `origin_note` varchar(120) NULL,
  `done_on` date NULL,
  `evidence_url` varchar(500) NULL,
  `evidence_asset` varchar(128) NULL,
  `proof_in_summary` tinyint(1) NOT NULL DEFAULT 0,
  -- NULL means Outside my roles.
  `role_id` varchar(64) NULL,
  `accountability_words` varchar(300) NULL,
  `season_goal_id` varchar(64) NULL,
  `own_goal_words` varchar(200) NULL,
  `state` varchar(12) NOT NULL DEFAULT 'suggested',
  `visibility` varchar(12) NOT NULL DEFAULT 'members',
  `review` varchar(12) NOT NULL DEFAULT 'pending',
  `review_note` varchar(500) NULL,
  `position` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `moon_recap_items_recap_dedupe` (`recap_id`, `dedupe_key`),
  KEY `moon_recap_items_dedupe` (`dedupe_key`)
);

CREATE TABLE IF NOT EXISTS `moon_invoices` (
  `id` varchar(64) NOT NULL,
  `recap_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `cycle_id` varchar(32) NOT NULL,
  `payer_key` varchar(64) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `bill_ref_seq` int NOT NULL,
  `member_number` varchar(40) NOT NULL,
  `currency` char(3) NOT NULL,
  `total_minor` bigint NOT NULL,
  `lines_json` mediumtext NOT NULL,
  `from_json` text NULL,
  `attestation_json` text NULL,
  `external_invoice_key` varchar(64) NULL,
  `status` varchar(24) NOT NULL DEFAULT 'waiting',
  `approval_hash` varchar(64) NULL,
  `expected_on` date NULL,
  `sent_at` timestamp NULL,
  `approved_at` timestamp NULL,
  `approved_by` varchar(64) NULL,
  `paid_on` date NULL,
  `paid_amount_minor` bigint NULL,
  `paid_currency` char(3) NULL,
  `fx_rate` decimal(18,8) NULL,
  `fx_source` varchar(120) NULL,
  `fx_date` date NULL,
  `fees_minor` bigint NULL,
  `funds_source` varchar(300) NULL,
  `void_of` varchar(64) NULL,
  `voided_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `moon_invoices_payer_bill_ref` (`payer_key`, `bill_ref_seq`),
  UNIQUE KEY `moon_invoices_member_cycle_payer` (`user_id`, `cycle_id`, `payer_key`, `revision`),
  UNIQUE KEY `moon_invoices_member_number` (`user_id`, `member_number`),
  KEY `moon_invoices_recap` (`recap_id`),
  KEY `moon_invoices_status` (`status`)
);

CREATE TABLE IF NOT EXISTS `member_pay_routes` (
  `user_id` varchar(64) NOT NULL,
  `route` varchar(16) NOT NULL DEFAULT 'pending',
  `payer_key` varchar(64) NULL,
  `currency` char(3) NULL,
  `legal_name` varchar(200) NULL,
  `address` varchar(500) NULL,
  `status_valid_until` date NULL,
  `tax_form_kind` varchar(8) NOT NULL DEFAULT 'none',
  `tax_form_signed_on` date NULL,
  `tax_form_expires_on` date NULL,
  `tax_form_filed_where` varchar(200) NULL,
  `confirmed_at` timestamp NULL,
  `confirmed_by` varchar(64) NULL,
  `pilot_ack_version` varchar(16) NULL,
  `pilot_ack_at` timestamp NULL,
  -- A change of bank account: only its date and the role that confirmed it.
  `bank_changed_on` date NULL,
  `bank_confirmed_by_role` varchar(64) NULL,
  -- The member's own invoice sequence, read and moved inside the send.
  `invoice_seq` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
);

CREATE TABLE IF NOT EXISTS `moon_review_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `recap_id` varchar(64) NULL,
  `invoice_id` varchar(64) NULL,
  `user_id` varchar(64) NULL,
  `kind` varchar(24) NOT NULL,
  `actor_user_id` varchar(64) NULL,
  `actor_role` varchar(64) NULL,
  `amount_minor` bigint NULL,
  `currency` char(3) NULL,
  `hash` varchar(64) NULL,
  `note` text NULL,
  `at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `moon_review_events_recap` (`recap_id`),
  KEY `moon_review_events_invoice` (`invoice_id`),
  KEY `moon_review_events_user` (`user_id`)
);
