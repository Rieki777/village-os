-- A path remembers who walks it, and a letter remembers who it went to.
--
-- Rye, 2026-10-02: somebody who chooses a path (resident, investor, steward,
-- prosperity creator) is walked through its next steps by email, the path's
-- own person is asked to write at three weeks, and a village can send a
-- letter to the people who agreed to get one (the comms build spec 5.11
-- and 5.12).
--
-- WHY A TABLE FOR PATHS. `users.paths` says which paths a member is on today
-- and nothing else. It cannot say when somebody joined a path, how they came
-- to it, whether they left, or whether they reached its goal, and it cannot
-- hold somebody with no account at all, who is most of the people a public
-- form brings in. A journey is timed from the joining, so the joining has to
-- be a row.
--
-- WHAT THE COLUMNS MEAN, where the DDL cannot say it:
--
--   path_enrollments.person_key  a user id, or `guest:<contactId>` for
--                              somebody with no account (the rule 0229
--                              writes down).
--   path_enrollments.source    how they came to the path: sign-up, a profile
--                              edit, a public form, a housing request, an
--                              investor packet, a Work With Us proposal,
--                              steward interest, or `backfill` for members
--                              already on a path when this shipped. A
--                              backfilled row sends nothing unless an admin
--                              asks for it.
--   path_enrollments.state     `active`, `left` or `done`.
--   path_enrollments.last_rung the rung of the path's ladder last seen, so a
--                              move up it is noticed once.
--
--   comms_letters.audience     who the letter is for, as data the letter
--                              screen built: members who said yes to
--                              letters, people on a path, a gathering's
--                              attendees, or every contact who said yes.
--   comms_letters.state        `draft`, `scheduled`, `sending`, `sent` or
--                              `cancelled`.
--   comms_letters.body_hash    the SHA-256 of the words that were confirmed.
--                              The confirm token is bound to it, so a letter
--                              edited after the preview cannot be sent on the
--                              old confirmation.
--   comms_letters.recipient_count, posted_count, skipped_count  the letter's
--                              own numbers for History.
--
--   comms_letter_recipients    the snapshot taken at the moment of sending,
--                              one row per address, so a letter's audience is
--                              what it was when somebody pressed Send.
--   comms_letter_recipients.status  `pending`, `posted` or `skipped`, with
--                              the reason in `skip_reason` and the post
--                              office row in `message_id`.
--
-- DEDUPE COLUMNS ARE NOT NULL: `path_enrollments_one` and
-- `comms_letters_idem`, for the reason 0228 gives.
--
-- NO CHARSET OR COLLATE CLAUSE, for the reason 0198 gives.
--
-- Expand-only: three new tables. The previous release does not know they exist.

CREATE TABLE IF NOT EXISTS `path_enrollments` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `person_key` varchar(100) NOT NULL,
  `user_id` varchar(64) NULL,
  `contact_id` varchar(64) NULL,
  `path_id` varchar(64) NOT NULL,
  `source` varchar(64) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'active',
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at` timestamp NULL,
  `done_at` timestamp NULL,
  `last_rung` varchar(64) NULL,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `path_enrollments_one` (`village_id`, `person_key`, `path_id`),
  KEY `path_enrollments_path` (`path_id`, `state`)
);

CREATE TABLE IF NOT EXISTS `comms_letters` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `subject` varchar(500) NOT NULL,
  `preheader` varchar(255) NULL,
  `body_md` mediumtext NOT NULL,
  `layout` varchar(32) NOT NULL DEFAULT 'plain',
  `audience` json NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'draft',
  `scheduled_for` timestamp NULL,
  `body_hash` char(64) NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `recipient_count` int NOT NULL DEFAULT 0,
  `posted_count` int NOT NULL DEFAULT 0,
  `skipped_count` int NOT NULL DEFAULT 0,
  `created_by` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  `sent_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_letters_idem` (`village_id`, `idempotency_key`),
  KEY `comms_letters_due` (`state`, `scheduled_for`)
);

CREATE TABLE IF NOT EXISTS `comms_letter_recipients` (
  `letter_id` varchar(64) NOT NULL,
  `email_key` varchar(191) NOT NULL,
  `contact_id` varchar(64) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `skip_reason` varchar(64) NULL,
  `message_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`letter_id`, `email_key`)
);
