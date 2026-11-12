-- 0379: proposed changes, reviewed on one page (the lead, 11 Nov 2026).
--
-- An agent proposes a change to a village setting; nothing live moves. A
-- person reads every proposal beside what is live, edits it in place, and
-- accepts a selection, each through the target's own route as that person
-- (server/routes/proposedChanges.ts, shared/proposedChanges.ts).
--
-- proposed_change_batches: a titled group reviewed together.
-- proposed_changes: one change of a known kind. body_json is what was
-- proposed, draft_json the person's edits saved as they type, accepted_json
-- what was accepted, lessons_json the field-level differences between the two
-- that agents read before drafting the next one. approved_by and
-- approval_note keep the connector's existing audit fields.
--
-- EXPAND ONLY. Two new tables, read and written by this release alone, so the
-- previous release never sees them. No UNIQUE index, so no dedupe column.
CREATE TABLE IF NOT EXISTS `proposed_change_batches` (
  `id` varchar(40) NOT NULL,
  `title` varchar(200) NOT NULL,
  `proposed_by` varchar(64) NOT NULL,
  `proposed_by_kind` varchar(8) NOT NULL DEFAULT 'agent',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_pcb_created` (`created_at`)
);

CREATE TABLE IF NOT EXISTS `proposed_changes` (
  `id` varchar(40) NOT NULL,
  `batch_id` varchar(40) NOT NULL,
  `position` int NOT NULL DEFAULT 0,
  `kind` varchar(32) NOT NULL,
  `target_json` text NOT NULL,
  `target_label` varchar(200) NOT NULL,
  `route_method` varchar(8) NOT NULL,
  `route_path` varchar(400) NOT NULL,
  `summary` varchar(400) NOT NULL,
  `body_json` mediumtext NOT NULL,
  `draft_json` mediumtext NULL,
  `draft_by` varchar(64) NULL,
  `draft_at` datetime(3) NULL,
  `status` varchar(12) NOT NULL DEFAULT 'proposed',
  `proposed_by` varchar(64) NOT NULL,
  `proposed_by_kind` varchar(8) NOT NULL DEFAULT 'agent',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decided_by` varchar(64) NULL,
  `decided_at` datetime(3) NULL,
  `accepted_json` mediumtext NULL,
  `lessons_json` mediumtext NULL,
  `approved_by` varchar(120) NULL,
  `approval_note` varchar(400) NULL,
  `error_text` varchar(1000) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pc_batch` (`batch_id`, `position`),
  KEY `idx_pc_status` (`status`, `created_at`),
  KEY `idx_pc_decided` (`decided_at`)
);
