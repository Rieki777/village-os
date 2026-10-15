-- 0252: a member is known outside the village by a code-name, and an outbox
-- records what would cross to the organisational memory service.
--
-- Two new tables and nothing else, so this file is expand-only: no ALTER, no
-- backfill, no statement that touches an existing table. A village that
-- already holds journal rows migrates by creating two empty tables, and the
-- previous release neither reads nor writes either of them, so rolling the
-- image back leaves two tables nobody asks about. Every statement is
-- `CREATE TABLE IF NOT EXISTS`, so a replay is a no-op.
--
-- THE RULINGS THIS SERVES (the founder's, 2026-10-02 and 2026-10-05):
--   - "full transparency but we can give all members code-names so we can
--     still give personalised feedback without exposing PII."
--   - "All journal entries go to Saberra (if that module is on) unless
--     specifically marked private."
--
-- NOTHING IS SENT BY THIS RELEASE. The service has not named a write path, so
-- the outbox records what WOULD cross and no transport reads it.
--
-- NO FOREIGN KEYS, the same as every table in this schema. `user_id` is
-- reconciled by the erasure sweep (server/lib/erasure.ts), which scrubs the
-- outbox and marks a member's code-name pending a vendor delete.

-- THE MAP FROM CODE-NAME TO PERSON. It never leaves the village: no route
-- returns `user_id` beside a code-name, and the resolve lives in
-- server/lib/codeNames.ts for the village's own use.
CREATE TABLE IF NOT EXISTS `member_code_names` (
  -- Two words and two digits, minted at random from a fixed word list, so it
  -- carries nothing about the person it names. Unique across every purpose,
  -- so a journal code-name can never collide with a later seat code-name.
  `code_name` varchar(64) NOT NULL,
  -- The person. NULL ONLY AFTER THE ENTRY IS DROPPED: dropping the map entry
  -- means forgetting who the code-name named, so the id goes, and the row
  -- stays so the code-name is never minted again for somebody else while a
  -- vendor may still hold old records under it. Every insert names a member.
  `user_id` varchar(64) NULL,
  -- Which map this code-name belongs to. `journal` today. A future seat-holder
  -- code-name takes its own purpose, so the two are never the same string.
  `purpose` varchar(32) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set by the erasure sweep. The entry stays, marked, until the vendor
  -- confirms a delete, because the village has to be able to name the
  -- person in that conversation.
  `pending_vendor_delete_at` timestamp NULL,
  -- Set when the vendor confirmed and the map entry was dropped.
  `dropped_at` timestamp NULL,
  PRIMARY KEY (`code_name`),
  -- ONE LIVE CODE-NAME PER MEMBER PER PURPOSE. A dropped row carries a NULL
  -- `user_id`, which a MySQL unique key exempts, and that is what lets every
  -- dropped row stand side by side. A live row always names a member, so the
  -- key holds exactly where a duplicate would hurt: two code-names for one
  -- person would let an erasure clear one and leave the other resolving.
  UNIQUE KEY `member_code_names_holder_uq` (`user_id`, `purpose`),
  KEY `member_code_names_pending_idx` (`pending_vendor_delete_at`)
);

-- WHAT WOULD CROSS, one row per thing, already code-named and name-swapped.
CREATE TABLE IF NOT EXISTS `saberra_outbox` (
  `id` varchar(64) NOT NULL,
  `kind` enum('journal_entry','team_signal') NOT NULL,
  -- `journal_entry:<entry id>` or `team_signal:<ISO week>`. UNIQUE, so no
  -- entry and no week is ever queued twice: a later edit updates the one row.
  `source_ref` varchar(128) NOT NULL,
  -- The author's code-name on a journal entry, NULL on a team signal. Kept
  -- as a column so an erasure can find a member's rows after their entries
  -- are gone, and so the admin listing never has to open a payload.
  `code_name` varchar(64) NULL,
  -- The entry's civil date (`2026-10-14`) or the signal's week (`2026-W42`).
  `period` varchar(16) NOT NULL DEFAULT '',
  -- JSON, exactly as it would be sent. NULL once withdrawn or scrubbed.
  `payload` mediumtext NULL,
  -- How many characters of member writing the payload carries. The admin
  -- listing shows this and never the text.
  `text_chars` int NOT NULL DEFAULT 0,
  -- The source's own updated instant in milliseconds, so a slower write of an
  -- older version never replaces a newer one.
  `source_version` bigint NOT NULL DEFAULT 0,
  `status` enum('queued','sent','failed','held') NOT NULL DEFAULT 'queued',
  `attempts` int NOT NULL DEFAULT 0,
  `last_error` varchar(300) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `sent_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `saberra_outbox_source_uq` (`source_ref`),
  KEY `saberra_outbox_status_idx` (`status`, `created_at`),
  KEY `saberra_outbox_code_name_idx` (`code_name`)
);
