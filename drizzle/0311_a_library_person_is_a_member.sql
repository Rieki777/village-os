-- Which knowledge-library person is which member, and the tasks nobody owns yet
-- ("Your list", PR 3: the steward import).
--
-- sera_person_links: the library's owner id for a person, and the member it
-- means. A steward sets it when they import a member's tasks; matching by email
-- comes later and writes the same row. Member-pii: deleted with the member on
-- erasure (forgetSeraPersonLinks in server/repos/memberTaskImport.ts).
--
-- member_task_import_queue: library tasks whose status is Needs Owner. They
-- never land on anybody's list; a steward routes them. They name no member.
--
-- Expand only: two new tables. Nothing dropped or renamed.

CREATE TABLE IF NOT EXISTS `sera_person_links` (
  `sera_owner_id` varchar(128) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `linked_by_user_id` varchar(64) NULL,
  `how` enum('steward','email') NOT NULL DEFAULT 'steward',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sera_owner_id`),
  KEY `sera_person_links_user` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `member_task_import_queue` (
  `external_id` varchar(128) NOT NULL,
  `title` varchar(200) NOT NULL,
  `import_batch` varchar(64) NOT NULL,
  `status` enum('waiting','routed','dismissed') NOT NULL DEFAULT 'waiting',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`external_id`)
);
