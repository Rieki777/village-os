-- The feedback bridge for "Your list" (PR E): why a member removed, redirected,
-- finished or re-tiered a task, kept here and sent to the knowledge library.
--
-- member_task_feedback: one row per action, keyed by a feedback_id the client
-- makes, so a retried press never writes twice. Reason, optional note and the
-- context the task was shown in (bucket, score, days on the list, surface).
-- The NOTE is held here until a steward releases notes; emails and phone
-- numbers are stripped before it ever leaves. Journal text is never in it.
-- Kept 12 months, then deleted by the bridge job.
--
-- member_task_outbox: what is owed to the library, retried until it lands.
-- member_task_prefs: the member's off switch for sending feedback (default on).
-- member_task_bridge: the village's bridge switches (notes held by default).
-- member_task_role_queue: tasks a member handed to a role; a steward routes them.
--
-- Member-pii: every row naming a member is deleted with them on erasure
-- (forgetMemberTaskFeedback in server/repos/memberTaskFeedback.ts).
--
-- Expand only: five new tables and two nullable/defaulted columns.

CREATE TABLE IF NOT EXISTS `member_task_feedback` (
  `feedback_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `task_id` varchar(64) NOT NULL,
  `action` varchar(24) NOT NULL,
  `screen_reason` varchar(32) NULL,
  `library_code` varchar(32) NULL,
  `note` varchar(1000) NULL,
  `context` text NULL,
  `redirect_to_user_id` varchar(64) NULL,
  `redirect_to_role_id` varchar(64) NULL,
  `review` enum('auto','steward') NOT NULL DEFAULT 'auto',
  `reviewed_at` timestamp NULL,
  `undone_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`feedback_id`),
  KEY `member_task_feedback_user` (`user_id`),
  KEY `member_task_feedback_task` (`task_id`),
  KEY `member_task_feedback_review` (`review`, `reviewed_at`)
);

CREATE TABLE IF NOT EXISTS `member_task_outbox` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` varchar(64) NULL,
  `feedback_id` varchar(64) NULL,
  `kind` varchar(24) NOT NULL,
  `payload` text NOT NULL,
  `status` enum('queued','held','sent','failed','dropped') NOT NULL DEFAULT 'queued',
  `attempts` smallint NOT NULL DEFAULT 0,
  `next_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_error` varchar(300) NULL,
  `sent_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `member_task_outbox_feedback_kind` (`feedback_id`, `kind`),
  KEY `member_task_outbox_due` (`status`, `next_at`),
  KEY `member_task_outbox_user` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `member_task_prefs` (
  `user_id` varchar(64) NOT NULL,
  `feedback_on` tinyint(1) NOT NULL DEFAULT 1,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
);

CREATE TABLE IF NOT EXISTS `member_task_bridge` (
  `setting` varchar(48) NOT NULL,
  `value` varchar(200) NOT NULL,
  `set_by_user_id` varchar(64) NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting`)
);

CREATE TABLE IF NOT EXISTS `member_task_role_queue` (
  `id` varchar(64) NOT NULL,
  `role_id` varchar(64) NOT NULL,
  `title` varchar(200) NOT NULL,
  `from_user_id` varchar(64) NULL,
  `feedback_id` varchar(64) NULL,
  `status` enum('waiting','taken','dismissed') NOT NULL DEFAULT 'waiting',
  `taken_by_user_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `member_task_role_queue_role` (`role_id`, `status`)
);

ALTER TABLE `member_tasks`
  ADD COLUMN `member_pinned` tinyint(1) NOT NULL DEFAULT 0;

ALTER TABLE `sera_person_links`
  ADD COLUMN `last_synced_at` timestamp NULL;
