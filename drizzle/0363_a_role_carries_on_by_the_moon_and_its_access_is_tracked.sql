-- 0363 (provisional, the integrator renames): moon renewal and the access bundle.
--
-- role_moon_renewals: a holder of a role that runs by the moon files "carry on"
-- with the next moon's contribution; one holder of the power to fill roles then
-- renews every filed role in one action, which writes the next moon's term on
-- the seating. Nothing renews by itself.
--
-- role_access_tasks: one row per access item per seating per kind. A grant task
-- is raised when the role starts, a revoke task when it ends. The row names the
-- item and its state. It never holds a credential, a username or a link.
--
-- EXPAND ONLY: two new tables, nothing existing is altered.
CREATE TABLE IF NOT EXISTS `role_moon_renewals` (
  `id` varchar(64) NOT NULL,
  `assignment_id` varchar(64) NOT NULL,
  `org_role_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `for_term_ends_at` timestamp NOT NULL,
  `contribution` text NULL,
  `status` enum('filed','renewed','withdrawn') NOT NULL DEFAULT 'filed',
  `next_term_ends_at` timestamp NULL,
  `filed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `renewed_at` timestamp NULL,
  `renewed_by` varchar(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_moon_renewals_term_uq` (`assignment_id`, `for_term_ends_at`),
  KEY `role_moon_renewals_status_idx` (`status`)
);

CREATE TABLE IF NOT EXISTS `role_access_tasks` (
  `id` varchar(64) NOT NULL,
  `assignment_id` varchar(64) NOT NULL,
  `org_role_id` varchar(64) NOT NULL,
  `holder_user_id` varchar(64) NULL,
  `item_key` varchar(64) NOT NULL,
  `item_label` varchar(160) NOT NULL,
  `kind` enum('grant','revoke') NOT NULL,
  `granting_role_id` varchar(64) NULL,
  `state` enum('open','done','not_needed') NOT NULL DEFAULT 'open',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `done_at` timestamp NULL,
  `done_by` varchar(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_access_tasks_item_uq` (`assignment_id`, `item_key`, `kind`),
  KEY `role_access_tasks_holder_idx` (`holder_user_id`),
  KEY `role_access_tasks_open_idx` (`state`, `granting_role_id`)
);
