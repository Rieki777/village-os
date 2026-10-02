-- A gathering asks when, and remembers who came.
--
-- Rye, 2026-10-02: guests who have no account may say they are coming to a
-- public gathering, the host marks who came and sends a recap, and a session
-- time can be put to a live vote whose leader IS the time on the calendar
-- (docs/comms/BUILD_SPEC.md sections 5.7 to 5.10).
--
-- NO EXISTING TABLE CHANGES. Everything one gathering needs for its emails
-- lives in `event_comms`, keyed by the event id, so the `events` table and
-- every query over it are untouched.
--
-- PERSON KEYS. A member is their user id. Somebody with no account is
-- `guest:<contactId>`, where the contact is their `comms_contacts` row. That
-- one string goes in `event_rsvps.user_id`, `event_waitlist.user_id` and
-- every `person_key` column below, so every seat count and waitlist read that
-- exists today counts a guest with no change at all. The same rule is written
-- again in server/lib/comms/guests.ts, where guests are made.
--
-- WHAT THE COLUMNS MEAN, where the DDL cannot say it:
--
--   event_comms.guests         NULL follows the village dial
--                              `comms.guests_default`, 1 is on, 0 is off.
--   event_comms.reminders      NULL follows the village dial
--                              `comms.event_reminder_minutes`, an empty list
--                              is off, and a list of minutes before the start
--                              is this gathering's own.
--   event_comms.ics_sequence   bumped on every change of time or place, and
--                              written as SEQUENCE in each calendar file, so
--                              a calendar app replaces the old entry.
--   event_comms.host_user_id   who hosts: the person asked for the recap.
--
--   event_guest_requests.token_hash  the SHA-256 of the confirm token. The
--                              token itself is never stored, so a read of
--                              this table cannot confirm anybody.
--   event_guest_requests.status  `pending` until the person confirms, then
--                              `confirmed`. A pending row past `expires_at`
--                              confirms nothing.
--
--   event_attendance.status    `came` or `missed`, marked by the host.
--
--   event_recaps.state         `draft` until the host presses send, then
--                              `sent`.
--   event_recaps.missed_note_md  the extra note for people who said yes and
--                              did not come.
--
--   event_feedback.question_key  which of the two recap questions in the
--                              comms settings this answers.
--
--   event_time_polls.mode      `once` for a single gathering, `weekly` for a
--                              recurring series.
--   event_time_polls.state     `open` or `locked`.
--   event_time_polls.pinned_option_id  the host's pin, which beats the vote.
--   event_time_polls.leader_option_id,
--   event_time_polls.leader_since  who leads the vote and since when, so a
--                              leader is applied only once it has led for
--                              `settle_minutes`.
--   event_time_polls.applied_option_id  the time last written to the
--                              gathering itself.
--   event_time_polls.show_names  1 shows voter names to signed-in members.
--                              The public always sees counts only.
--
--   event_time_poll_options.starts_at  a candidate start for a `once` poll,
--                              a DATETIME in the convention
--                              server/lib/calendar.ts defines for
--                              `events.starts_at`.
--   event_time_poll_options.weekday,
--   event_time_poll_options.start_minute  a candidate weekly slot for a
--                              `weekly` poll: a day of the week and the
--                              minutes after midnight, in village time.
--   event_time_poll_options.removed_at  an option taken off the poll. Its
--                              votes stay as the record of what was asked.
--
--   event_time_poll_votes      approval voting: one row per option a person
--                              can make, so a vote for three times is three
--                              rows.
--
-- `occurrence_key` follows `event_rsvps`: the village-time date of one
-- evening of a recurring gathering, and '' for a one-off. NOT NULL with a
-- default, because it is part of every primary key it appears in.
--
-- NO CHARSET OR COLLATE CLAUSE, for the reason 0198 gives.
--
-- Expand-only: eight new tables. The previous release does not know they exist.

CREATE TABLE IF NOT EXISTS `event_comms` (
  `event_id` varchar(64) NOT NULL,
  `guests` tinyint(1) NULL,
  `reminders` json NULL,
  `ics_sequence` int NOT NULL DEFAULT 0,
  `host_user_id` varchar(64) NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`)
);

CREATE TABLE IF NOT EXISTS `event_guest_requests` (
  `id` varchar(64) NOT NULL,
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `contact_id` varchar(64) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NULL,
  `confirmed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_guest_requests_token` (`token_hash`),
  KEY `event_guest_requests_event` (`event_id`, `occurrence_key`),
  KEY `event_guest_requests_contact` (`contact_id`)
);

CREATE TABLE IF NOT EXISTS `event_attendance` (
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `person_key` varchar(100) NOT NULL,
  `status` varchar(16) NOT NULL,
  `marked_by` varchar(64) NOT NULL,
  `marked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`, `occurrence_key`, `person_key`)
);

CREATE TABLE IF NOT EXISTS `event_recaps` (
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `body_md` mediumtext NOT NULL,
  `missed_note_md` mediumtext NULL,
  `recording_url` varchar(500) NULL,
  `state` varchar(16) NOT NULL DEFAULT 'draft',
  `author_user_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  `sent_at` timestamp NULL,
  PRIMARY KEY (`event_id`, `occurrence_key`)
);

CREATE TABLE IF NOT EXISTS `event_feedback` (
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `person_key` varchar(100) NOT NULL,
  `question_key` varchar(32) NOT NULL,
  `answer` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`event_id`, `occurrence_key`, `person_key`, `question_key`)
);

CREATE TABLE IF NOT EXISTS `event_time_polls` (
  `id` varchar(64) NOT NULL,
  `event_id` varchar(64) NOT NULL,
  `mode` varchar(16) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'open',
  `closes_at` timestamp NULL,
  `settle_minutes` int NOT NULL DEFAULT 0,
  `freeze_hours` int NOT NULL DEFAULT 48,
  `pinned_option_id` varchar(64) NULL,
  `leader_option_id` varchar(64) NULL,
  `leader_since` timestamp NULL,
  `applied_option_id` varchar(64) NULL,
  `show_names` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `locked_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_time_polls_event` (`event_id`)
);

CREATE TABLE IF NOT EXISTS `event_time_poll_options` (
  `id` varchar(64) NOT NULL,
  `poll_id` varchar(64) NOT NULL,
  `starts_at` datetime NULL,
  `weekday` tinyint NULL,
  `start_minute` int NULL,
  `duration_minutes` int NOT NULL DEFAULT 60,
  `position` int NOT NULL DEFAULT 0,
  `removed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `event_time_poll_options_poll` (`poll_id`)
);

CREATE TABLE IF NOT EXISTS `event_time_poll_votes` (
  `poll_id` varchar(64) NOT NULL,
  `option_id` varchar(64) NOT NULL,
  `person_key` varchar(100) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`poll_id`, `option_id`, `person_key`),
  KEY `event_time_poll_votes_person` (`poll_id`, `person_key`)
);
