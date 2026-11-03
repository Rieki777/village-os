-- A member keeps their own task list ("Your list", PR 1).
--
-- member_tasks holds one row per task a member holds for themselves: typed by
-- hand, made from a journal entry, or brought in from the knowledge library.
-- Removed rows are TOMBSTONES: the row stays with its source and external id,
-- so a task the library sends again is ignored and never comes back. Its words
-- are cleared once the 30-day restore window has passed (in TypeScript, on
-- read and on the sweep), never by a migration.
--
-- private_detail is the journal text a task was made from. Only its member
-- reads it. No steward view, no outbound feed.
--
-- member_task_events is append-only: every add, edit, done, remove, restore.
-- member_task_access is the per-member switch. It starts off; a steward turns
-- it on for a member.
--
-- Member-pii (Module Library Contract clause 13): shown to the member alone,
-- in their export, and deleted with the member on erasure
-- (forgetMemberTasks in server/repos/memberTasks.ts).
--
-- Expand only: three new tables. Nothing dropped or renamed.

CREATE TABLE IF NOT EXISTS `member_tasks` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `title` varchar(200) NOT NULL,
  `private_detail` text NULL,
  `tier` enum('high','priority','not_yet') NOT NULL DEFAULT 'priority',
  `horizon` enum('today','week','later') NULL,
  `due_on` date NULL,
  `minutes` smallint NULL,
  `status` enum('open','done','removed') NOT NULL DEFAULT 'open',
  `remove_reason` varchar(32) NULL,
  `pinned` tinyint(1) NOT NULL DEFAULT 0,
  `source` varchar(16) NOT NULL DEFAULT 'self',
  -- NULL for a hand-made task, so the unique key below admits any number of
  -- them. The library's task id for source 'sera': one row per member, ever.
  `external_id` varchar(128) NULL,
  `import_batch` varchar(64) NULL,
  -- Set when the member edits a row the library sent, so a rerun never overwrites them.
  `member_edited` tinyint(1) NOT NULL DEFAULT 0,
  `confidence` decimal(4,3) NULL,
  `not_now_count` smallint NOT NULL DEFAULT 0,
  `version` int NOT NULL DEFAULT 1,
  `created_on` date NOT NULL,
  `done_at` timestamp NULL,
  `removed_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `member_tasks_user_source_external` (`user_id`, `source`, `external_id`),
  KEY `member_tasks_user_status` (`user_id`, `status`),
  KEY `member_tasks_batch` (`import_batch`)
);

CREATE TABLE IF NOT EXISTS `member_task_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `kind` varchar(24) NOT NULL,
  -- JSON of codes and fields changed. Never the private detail.
  `detail` text NULL,
  `by_user_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `member_task_events_task` (`task_id`),
  KEY `member_task_events_user` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `member_task_access` (
  `user_id` varchar(64) NOT NULL,
  `list_on` tinyint(1) NOT NULL DEFAULT 0,
  `set_by_user_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
);
