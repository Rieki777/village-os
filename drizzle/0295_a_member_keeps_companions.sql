-- 0295: a member keeps companions.
--
-- Three new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes them, and rolling an image back over a
-- migrated database leaves three tables nobody asks about. No ALTER.
--
-- THE CONTRACT IS shared/companionItems.ts. The draft kinds, which door each
-- one opens on a yes, the daily question cap and the expiry are named there
-- once, and server/lib/companions.ts holds the policy.
--
-- WHAT IT HOLDS. A member's companions (one personal, one for each role they
-- hold that has one, one for each quest or project that has one), what each
-- companion brings them (a question to answer, or a draft that waits for a
-- yes), and each companion's chat. All three are the member's own, so the
-- erasure sweep deletes them whole (server/lib/erasure.ts, "companions").
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `companions` (
  `id` varchar(64) NOT NULL,
  `owner_user_id` varchar(64) NOT NULL,
  `scope` enum('personal','role','quest','project') NOT NULL,
  -- '' for the personal companion: a NULL inside the unique key below would
  -- admit duplicates. A role id, a quest id, or the outside project's page id.
  `scope_id` varchar(128) NOT NULL DEFAULT '',
  -- village (the village guide's engine) or saberra. A varchar, so a third
  -- provider is refused in code and costs no migration.
  `provider` varchar(32) NOT NULL DEFAULT 'village',
  `name` varchar(60) NOT NULL,
  -- JSON: { source: choose | forge | upload, pet?, tint?, portraitKey? }.
  -- It points into the character and portrait pipeline. No second image store.
  `look` text NULL,
  -- The member may lower it. The village sets the ceiling
  -- (companions.max_questions_per_day).
  `daily_question_cap` tinyint NOT NULL DEFAULT 3,
  `status` enum('active','resting','retired') NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set by every write: the column has no ON UPDATE.
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `companions_scope_uq` (`owner_user_id`, `scope`, `scope_id`),
  KEY `companions_scope_idx` (`scope`, `scope_id`, `status`)
);

CREATE TABLE IF NOT EXISTS `companion_items` (
  `id` varchar(64) NOT NULL,
  `companion_id` varchar(64) NOT NULL,
  -- Denormalised at landing, so one member's list reads one table.
  `owner_user_id` varchar(64) NOT NULL,
  `type` enum('question','draft') NOT NULL,
  -- For a draft: one of DRAFT_KINDS in shared/companionItems.ts, checked in
  -- code. An unknown kind is refused the day it arrives.
  `draft_kind` varchar(32) NULL,
  `title` varchar(200) NOT NULL,
  `body` text NULL,
  -- JSON, per kind. Validated at landing AND again at the yes.
  `payload` text NULL,
  -- The evidence block, the same three columns as external_proposals. No
  -- quote and no source means the item is held and never shown.
  `quote` text NULL,
  `source_ref` varchar(400) NULL,
  `source_occurred_at` datetime NULL,
  -- sera, maia, or chat (the member asked for it in chat).
  `origin` varchar(16) NOT NULL,
  -- The outside service's record id, so a re-sync updates the row.
  `external_ref` varchar(128) NULL,
  `dedupe_key` varchar(191) NOT NULL,
  -- Someone is stuck until the member answers.
  `blocking` tinyint(1) NOT NULL DEFAULT 0,
  `due_on` date NULL,
  -- The village-local day it was shown on, or landed on while held. The
  -- daily cap counts this column.
  `day_key` date NOT NULL,
  `status` enum('held','open','answered','confirmed','declined','expired','withdrawn') NOT NULL DEFAULT 'open',
  -- The member's clarification, or their edits to a draft.
  `answer` text NULL,
  -- JSON list: which fields the member changed before saying yes.
  `edited_fields` text NULL,
  -- What the yes made: the transfer, the RSVP, the review row, the message.
  `outcome_ref` varchar(128) NULL,
  `decided_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `companion_items_dedupe_uq` (`dedupe_key`),
  KEY `companion_items_owner_idx` (`owner_user_id`, `status`),
  KEY `companion_items_companion_idx` (`companion_id`, `type`, `day_key`, `status`)
);

CREATE TABLE IF NOT EXISTS `companion_messages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `companion_id` varchar(64) NOT NULL,
  `owner_user_id` varchar(64) NOT NULL,
  -- member or companion.
  `speaker` varchar(16) NOT NULL,
  -- Which engine answered, named above the chat every time.
  `engine` varchar(32) NOT NULL DEFAULT 'village',
  `body` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `companion_messages_companion_idx` (`companion_id`, `id`),
  KEY `companion_messages_owner_idx` (`owner_user_id`)
);
