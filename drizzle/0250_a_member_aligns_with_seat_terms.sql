-- 0250: the alignment store. A member aligns with words, one click from their own account.
--
-- WHAT THIS IS FOR.
-- Seat settings PR5. When a member applies for seats on terms, the words of
-- those terms are written once into `alignment_texts`, the people who must
-- align with them into `alignment_parties`, and each act of aligning into
-- `alignments`. When every required party has aligned, the server signs a
-- receipt over the hash and the party list into `alignment_seals`. The
-- village's own alignment is the holder's adopt click, or the landed ballot.
--
-- INSERT ONLY. Nothing updates or deletes a row in these four tables, with
-- one named exception: server/lib/alignmentErasure.ts, the erasure step,
-- which scrubs a departed member's name out of a text's words and stamps
-- `redacted_at`. The hash and the seal stay as they were, so the other
-- party's receipt still verifies. A grep test holds every other file to it.
--
-- IN FORCE IS NEVER STORED. It is derived on read: every required party has
-- aligned with a matching hash, today sits inside the effective window, and,
-- for seat terms, a seating carrying the application's id is still open.
--
-- THE SALT. `content_hash` is sha256 over the canonical bytes of the salt,
-- the subject, the version, the title, the words, the settings and the
-- parties. The salt is 32 random bytes and is never served outside a member
-- page or a receipt, so a hash cannot be brute-forced back into a stipend.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS. Four new tables. The previous release
-- names none of them, so it keeps running if it is put back over a migrated
-- database.

CREATE TABLE IF NOT EXISTS `alignment_texts` (
  -- 'at-' and sixteen hex characters.
  `id` varchar(40) NOT NULL,
  -- seat_terms today. membership and agreement later.
  `subject_type` varchar(24) NOT NULL,
  -- For seat_terms, the application id.
  `subject_ref` varchar(64) NOT NULL,
  `version` int NOT NULL,
  `title` varchar(200) NOT NULL,
  -- The exact words shown beside the button.
  `body` mediumtext NOT NULL,
  `settings_json` json NULL,
  `salt` char(64) NOT NULL,
  `content_hash` char(64) NOT NULL,
  `supersedes_id` varchar(40) NULL,
  `effective_from` date NULL,
  `effective_to` date NULL,
  `created_by` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL,
  -- Written only by the erasure step.
  `redacted_at` datetime NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `alignment_texts_subject_version` (`subject_type`, `subject_ref`, `version`)
);

CREATE TABLE IF NOT EXISTS `alignment_parties` (
  `text_id` varchar(40) NOT NULL,
  -- 'user:<id>' or 'village'.
  `party_key` varchar(80) NOT NULL,
  `user_id` varchar(64) NULL,
  `capacity` varchar(120) NOT NULL,
  `required` tinyint NOT NULL,
  -- The primary key is the pair: a host with sql_require_primary_key refuses a
  -- table without one, and a migration that fails stops the village booting.
  PRIMARY KEY (`text_id`, `party_key`),
  KEY `alignment_parties_user_idx` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `alignments` (
  `id` varchar(40) NOT NULL,
  `text_id` varchar(40) NOT NULL,
  `party_key` varchar(80) NOT NULL,
  `user_id` varchar(64) NULL,
  `content_hash` char(64) NOT NULL,
  -- The sentence beside the button.
  `intent_text` varchar(300) NOT NULL,
  -- click, holder or ballot.
  `method` varchar(8) NOT NULL,
  -- The ballot id, or the power and seat a holder adopted under.
  `authority_ref` varchar(64) NULL,
  -- Set by the server, never by the client.
  `at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `alignments_text_party` (`text_id`, `party_key`),
  KEY `alignments_user_idx` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `alignment_seals` (
  `text_id` varchar(40) NOT NULL,
  -- signDocument over the hash, the parties and the alignments. Never the words.
  `receipt_json` mediumtext NOT NULL,
  `at` datetime NOT NULL,
  PRIMARY KEY (`text_id`)
);
