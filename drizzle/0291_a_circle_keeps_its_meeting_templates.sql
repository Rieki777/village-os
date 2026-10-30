-- 0291: a circle keeps its meeting templates.
--
-- Four new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes them, and rolling an image back over a
-- migrated database leaves four tables nobody asks about. No ALTER.
--
-- THE CONTRACT IS shared/sessionTemplates.ts. The section kinds, the limits,
-- the three seeded templates and every sentence a member reads are named
-- there once.
--
-- WHAT IT HOLDS. A meeting the village holds again and again (a template:
-- name, category, usual circle and length, and an ordered flow of sections
-- as JSON), which sessions were opened from which template (so the sessions
-- of one template are a series), the priorities a meeting chose and how the
-- next meeting marked them, and what was shared around a talking stick.
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in every
-- Live Sessions table. 0 means a member who has since left the village.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `category` varchar(60) NOT NULL,
  `summary` varchar(400) NOT NULL DEFAULT '',
  -- A live circle's id, or NULL for no circle in particular.
  `circle_id` varchar(64) NULL,
  -- NULL: the village's usual length.
  `duration_min` smallint NULL,
  -- JSON: the ordered sections, each { key, kind, title, prompt, minutes }.
  `flow` text NOT NULL,
  -- Order inside its category, lowest first.
  `position` int NOT NULL DEFAULT 1,
  -- active or archived. A template is never deleted: a series still names it.
  `status` varchar(10) NOT NULL DEFAULT 'active',
  -- The template whose latest session this one reads back, or NULL.
  `feeds_from_id` int NULL,
  -- Set only on the rows the platform seeds, so seeding twice writes once.
  -- MySQL's unique index lets every NULL through, which is what a
  -- template a person made wants.
  `seed_key` varchar(40) NULL,
  `created_by_no` int NOT NULL DEFAULT 0,
  `updated_by_no` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set by every write: the column has no ON UPDATE.
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `live_session_templates_seed_uq` (`seed_key`),
  KEY `live_session_templates_category_idx` (`category`, `position`)
);

CREATE TABLE IF NOT EXISTS `live_session_template_uses` (
  -- One row per session opened from a template.
  `session_id` int NOT NULL,
  `template_id` int NOT NULL,
  -- JSON: the talking stick, { order, at, rounds }. NULL while it rests.
  `stick` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  KEY `live_session_template_uses_series_idx` (`template_id`, `session_id`)
);

CREATE TABLE IF NOT EXISTS `live_session_priorities` (
  `id` int NOT NULL AUTO_INCREMENT,
  -- The session that chose it.
  `session_id` int NOT NULL,
  `position` int NOT NULL DEFAULT 1,
  `text` varchar(200) NOT NULL,
  `author_no` int NOT NULL DEFAULT 0,
  -- done, partly or carried; NULL until a later meeting marks it.
  `outcome` varchar(10) NULL,
  -- The session that marked it, so its read-back can be found.
  `outcome_session_id` int NULL,
  `outcome_by_no` int NOT NULL DEFAULT 0,
  -- The priority it was carried from, when one was taken up again.
  `carried_from_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `live_session_priorities_session_idx` (`session_id`, `position`),
  KEY `live_session_priorities_outcome_idx` (`outcome_session_id`)
);

CREATE TABLE IF NOT EXISTS `live_session_shares` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` int NOT NULL,
  -- grateful, working, not_working or tension.
  `kind` varchar(12) NOT NULL,
  `text` varchar(1000) NOT NULL,
  -- Who held the stick when it was said, 0 for nobody.
  `speaker_no` int NOT NULL DEFAULT 0,
  `author_no` int NOT NULL DEFAULT 0,
  -- The agenda library item it became, when it was brought to a later session.
  `library_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `live_session_shares_session_idx` (`session_id`),
  KEY `live_session_shares_speaker_idx` (`speaker_no`),
  KEY `live_session_shares_author_idx` (`author_no`)
);
