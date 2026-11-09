-- Role journey L13 (tier B): what the connector proposes waits here for a person.
-- A seating proposal and a drafted letter. A role change is an org draft, not a row here.
-- Expand only: one new table, nothing else touched.
CREATE TABLE IF NOT EXISTS `agent_proposals` (
  `id` varchar(64) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'waiting',
  `proposed_by` varchar(64) NOT NULL,
  `role_id` varchar(64) NULL,
  `subject_user_id` varchar(64) NULL,
  `application_ref` varchar(64) NULL,
  `effective_from` varchar(10) NULL,
  `title` varchar(200) NOT NULL DEFAULT '',
  `body` text NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolved_by` varchar(64) NULL,
  `resolved_at` timestamp(3) NULL,
  PRIMARY KEY (`id`),
  KEY `agent_proposals_waiting` (`kind`, `status`, `created_at`),
  KEY `agent_proposals_by` (`proposed_by`, `kind`, `status`)
) ENGINE=InnoDB;
