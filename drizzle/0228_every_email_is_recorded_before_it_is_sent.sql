-- Every email is recorded before it is sent.
--
-- Rye, 2026-10-02: one post office every email passes through, one address
-- book with permissions, words a village can edit, and one journey engine
-- that runs both event emails and path emails (docs/comms/BUILD_SPEC.md).
-- Until now an email left this platform through one function that called the
-- provider and kept nothing, so nobody could answer "did that person get it",
-- nothing could stop a second copy of the same letter, and a person who asked
-- to stop hearing from the village had nowhere to be written down.
--
-- THE ROW COMES FIRST. `comms_messages` is written before the provider is
-- called, so a send that dies half way is still a row somebody can read, and
-- the row id rides to the provider as its Idempotency-Key, so a retry after a
-- crash cannot deliver twice.
--
-- DEDUPE COLUMNS ARE NOT NULL, because a MySQL UNIQUE index exempts NULLs and
-- a nullable key in one admits any number of duplicates. That covers
-- `comms_messages.idempotency_key`, `comms_contacts.email_key` and the four
-- columns of `comms_enrollments_once`.
--
-- WHAT THE COLUMNS MEAN, where the DDL cannot say it:
--
--   comms_contacts.email_key   the address trimmed and lowercased, and
--                              nothing else folded. `email` keeps what the
--                              person typed.
--   comms_contacts.first_source  where the address was first seen, kept
--                              when later sources add to it.
--
--   comms_permissions.kind     one of `events`, `paths`, `letters`,
--                              `notices`. `essential` is never stored: a
--                              password link always goes.
--   comms_permissions.state    `yes` or `no`.
--   comms_permissions.basis    `asked`, `implied`, `account` or `imported`.
--   comms_permissions.evidence the form id, and the words the person saw
--                              when they said yes.
--
--   comms_suppressions.reason  `bounced`, `complained`, `unsubscribed_all`,
--                              `manual` or `erased`. `detail` carries the
--                              reason somebody gave for restoring a
--                              complained address.
--
--   comms_messages.status      `queued`, `sending`, `sent`, `delivered`,
--                              `bounced`, `complained`, `failed`, `skipped`,
--                              `expired`, `rehearsed` or `cancelled`.
--   comms_messages.skip_reason why a row never went, from the list in
--                              shared/comms/kinds.ts.
--   comms_messages.origin      what made the email, for example
--                              `auth.reset`, `notify.immediate`, `journey`,
--                              `event.changed` or `letter`.
--   comms_messages.body_html,
--   comms_messages.body_text   cleared by retention. The row outlives the
--                              words so the record of who was written to
--                              survives the words themselves.
--   comms_messages.rehearsal_to  where a rehearsed email really went, while
--                              the village rehearses with the module in
--                              preview.
--
--   comms_provider_events.id   the provider's own delivery id (Svix's
--                              `svix-id`), so a redelivered report is
--                              stored once.
--
--   comms_templates.state      `live` or `retired`. One live row per key.
--   comms_templates.platform_version  the platform default this village's
--                              copy was taken from, so an improved default
--                              can be offered without being forced.
--
--   comms_journeys.definition  NULL while the platform default applies.
--                              Every save writes `comms_journey_versions`
--                              and bumps `version`.
--
--   comms_enrollments.subject_ref  one of `event:<id>:<occ>`,
--                              `path:<pathId>`, `form:<submissionId>`,
--                              `account` or `poll:<pollId>`.
--   comms_enrollments.journey_version  the version the person started on,
--                              kept when the journey is edited later.
--
-- NO CHARSET OR COLLATE CLAUSE, for the reason 0198 gives: these ids are
-- joined against `users`, and a pinned collation would put these tables in a
-- different collation era from those rows.
--
-- Expand-only: nine new tables. The previous release does not know they exist.

CREATE TABLE IF NOT EXISTS `comms_contacts` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `email_key` varchar(191) NOT NULL,
  `email` varchar(320) NOT NULL,
  `name` varchar(255) NULL,
  `user_id` varchar(64) NULL,
  `first_source` varchar(64) NOT NULL,
  `timezone` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_contacts_email` (`village_id`, `email_key`),
  KEY `comms_contacts_user` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `comms_permissions` (
  `contact_id` varchar(64) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `state` varchar(16) NOT NULL,
  `basis` varchar(16) NOT NULL,
  `source` varchar(64) NOT NULL,
  `evidence` json NULL,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`contact_id`, `kind`)
);

CREATE TABLE IF NOT EXISTS `comms_suppressions` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `email_key` varchar(191) NOT NULL,
  `reason` varchar(32) NOT NULL,
  `detail` varchar(500) NULL,
  `created_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `email_key`)
);

CREATE TABLE IF NOT EXISTS `comms_messages` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `idempotency_key` varchar(191) NOT NULL,
  `contact_id` varchar(64) NULL,
  `user_id` varchar(64) NULL,
  `to_email` varchar(320) NOT NULL,
  `email_key` varchar(191) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `origin` varchar(64) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `template_key` varchar(100) NULL,
  `template_version` int NULL,
  `journey_key` varchar(100) NULL,
  `step_key` varchar(64) NULL,
  `enrollment_id` varchar(64) NULL,
  `letter_id` varchar(64) NULL,
  `body_html` mediumtext NULL,
  `body_text` mediumtext NULL,
  `headers` json NULL,
  `attachments` json NULL,
  `reply_to` varchar(320) NULL,
  `status` varchar(16) NOT NULL DEFAULT 'queued',
  `skip_reason` varchar(64) NULL,
  `rehearsal_to` varchar(320) NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `next_attempt_at` timestamp NULL,
  `send_after` timestamp NULL,
  `expires_at` timestamp NULL,
  `provider` varchar(32) NULL,
  `provider_message_id` varchar(128) NULL,
  `last_error` varchar(500) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  `sent_at` timestamp NULL,
  `delivered_at` timestamp NULL,
  `bounced_at` timestamp NULL,
  `complained_at` timestamp NULL,
  `opened_at` timestamp NULL,
  `clicked_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_messages_idem` (`village_id`, `idempotency_key`),
  KEY `comms_messages_due` (`status`, `send_after`),
  KEY `comms_messages_contact` (`contact_id`, `created_at`),
  KEY `comms_messages_email` (`email_key`, `created_at`),
  KEY `comms_messages_provider` (`provider_message_id`),
  KEY `comms_messages_journey` (`journey_key`, `step_key`),
  KEY `comms_messages_letter` (`letter_id`)
);

CREATE TABLE IF NOT EXISTS `comms_provider_events` (
  `id` varchar(191) NOT NULL,
  `type` varchar(64) NOT NULL,
  `provider_message_id` varchar(128) NULL,
  `message_id` varchar(64) NULL,
  `payload` json NOT NULL,
  `received_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` timestamp NULL,
  `outcome` varchar(64) NULL,
  PRIMARY KEY (`id`),
  KEY `comms_provider_events_msg` (`provider_message_id`)
);

CREATE TABLE IF NOT EXISTS `comms_templates` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `template_key` varchar(100) NOT NULL,
  `version` int NOT NULL,
  `subject` varchar(500) NOT NULL,
  `preheader` varchar(255) NULL,
  `body_md` mediumtext NOT NULL,
  `layout` varchar(32) NOT NULL DEFAULT 'plain',
  `platform_version` int NULL,
  `state` varchar(16) NOT NULL DEFAULT 'live',
  `edited_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `template_key`, `version`),
  KEY `comms_templates_live` (`village_id`, `template_key`, `state`)
);

CREATE TABLE IF NOT EXISTS `comms_journeys` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `journey_key` varchar(100) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'off',
  `version` int NOT NULL DEFAULT 1,
  `definition` json NULL,
  `platform_version` int NULL,
  `updated_by` varchar(64) NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `journey_key`)
);

CREATE TABLE IF NOT EXISTS `comms_journey_versions` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `journey_key` varchar(100) NOT NULL,
  `version` int NOT NULL,
  `definition` json NOT NULL,
  `created_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `journey_key`, `version`)
);

CREATE TABLE IF NOT EXISTS `comms_enrollments` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `journey_key` varchar(100) NOT NULL,
  `journey_version` int NOT NULL,
  `contact_id` varchar(64) NOT NULL,
  `subject_ref` varchar(191) NOT NULL,
  `facts` json NULL,
  `state` varchar(16) NOT NULL DEFAULT 'active',
  `stop_reason` varchar(64) NULL,
  `enrolled_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `next_check_at` timestamp NULL,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_enrollments_once` (`village_id`, `journey_key`, `contact_id`, `subject_ref`),
  KEY `comms_enrollments_due` (`state`, `next_check_at`),
  KEY `comms_enrollments_subject` (`subject_ref`)
);
