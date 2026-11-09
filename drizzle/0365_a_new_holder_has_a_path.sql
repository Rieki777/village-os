-- 0365: a new holder has an onboarding path ("Your first moons in <role>").
--
-- Three new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes them. No ALTER, no foreign keys.
--
-- THE CONTRACT IS shared/onboardingPath.ts. A path opens when a holder is
-- seated and is the holder's own. Its items are copied from the merged list
-- (platform, village, circle, the role card) at that moment, so a later edit
-- of the village's list never rewrites a path somebody is part way through.
-- A check-in is read by the holder, the buddy and the holder of the village's
-- onboarding role, and by nobody else. The erasure sweep deletes the holder's
-- rows whole (server/lib/erasure.ts, "onboarding").

CREATE TABLE IF NOT EXISTS `onboarding_paths` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  -- The seating this path belongs to: one path per seating, whichever door seated.
  `assignment_id` varchar(64) NOT NULL,
  `org_role_id` varchar(64) NOT NULL,
  `circle_id` varchar(64) NULL,
  `buddy_user_id` varchar(64) NULL,
  `opened_on` date NOT NULL,
  `due_on` date NOT NULL,
  `status` enum('open','done','ended') NOT NULL DEFAULT 'open',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `onboarding_path_assignment_uq` (`assignment_id`),
  KEY `onboarding_path_user_idx` (`user_id`, `status`),
  KEY `onboarding_path_buddy_idx` (`buddy_user_id`)
);

CREATE TABLE IF NOT EXISTS `onboarding_items` (
  `id` varchar(64) NOT NULL,
  `path_id` varchar(64) NOT NULL,
  `item_key` varchar(64) NOT NULL,
  `kind` varchar(16) NOT NULL DEFAULT 'plain',
  `title` varchar(160) NOT NULL,
  `owner_key` varchar(16) NOT NULL DEFAULT 'holder',
  `due_day` smallint NOT NULL DEFAULT 30,
  `done_when` varchar(200) NOT NULL DEFAULT '',
  `source` varchar(16) NOT NULL DEFAULT 'platform',
  `sort_order` smallint NOT NULL DEFAULT 0,
  `done_at` timestamp NULL DEFAULT NULL,
  `done_by` varchar(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `onboarding_item_key_uq` (`path_id`, `item_key`)
);

CREATE TABLE IF NOT EXISTS `onboarding_checkins` (
  `id` varchar(64) NOT NULL,
  `path_id` varchar(64) NOT NULL,
  `day` smallint NOT NULL,
  `author_user_id` varchar(64) NOT NULL,
  `answers` text NOT NULL,
  `filed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `onboarding_checkin_day_uq` (`path_id`, `day`)
);
