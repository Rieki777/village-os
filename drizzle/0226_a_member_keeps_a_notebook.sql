-- 0226: a member keeps a notebook of their own documents, may offer one to
-- the village, and the village and each member keep a short list of canvas
-- resources they picked.
--
-- Plan sections 5.5 ("Create your own notebook") and 5.6 ("Take the canvas
-- with you"), Wave 4 of the Governance Canvas build.
--
-- ── village_documents: one row per document a member added ───────────────
--
-- `owner_user_id` is the member who added it, at the width of `users.id`.
-- `kind` is `md`, `txt` or `paste` (text, kept in `body` and searched) or
-- `pdf` or `docx` (stored whole in `village_document_files`, never searched,
-- `body` NULL). A varchar, never an enum: widening a live enum is the
-- forbidden migration class (0019's header).
--
-- PRIVATE BY DEFAULT. `shared_with_village` is 0 on every new row, and the
-- only statement that sets it to 1 runs when the village's pen ADOPTS the
-- owner's "Share with the village" suggestion (a canvas suggestion with the
-- target `document`, 0223). Nothing else shares a document, and an owner
-- cannot share one alone.
--
-- `model_consent_to` and `model_consent_at` record the one-line disclosure
-- the owner said yes to before this document's text was first sent to a
-- model provider ("Anthropic, under this village's own key", and so on). A
-- different provider or operator later is a different disclosure, so the
-- route asks again whenever the stored words differ from today's.
--
-- `body` is MEDIUMTEXT for 0223's reason: TEXT holds 65,535 BYTES, and a
-- long document in Cyrillic or CJK would be refused well under the character
-- limit the route states.
--
-- ── village_document_files: the bytes of a stored PDF or DOCX ─────────────
--
-- IN THE DATABASE, NOT ON THE UPLOADS VOLUME, ON PURPOSE. The volume's one
-- reader, `/api/uploads/:filename`, has no sign-in in front of it and answers
-- any address it is given, so a private document written there is a private
-- document anybody holding the name can fetch. Here the bytes are read only
-- through the documents route, which asks who is reading first, and a
-- member's erasure removes them with the same DELETE that removes the row, so
-- no file can outlive its owner's leaving. The route caps a stored file at
-- 8 MB, inside the smallest `max_allowed_packet` a supported engine ships
-- with (16 MB on MariaDB).
--
-- ── canvas_resource_picks: a resource somebody chose to keep close ─────────
--
-- `user_id` NOT NULL DEFAULT '' and the empty string means THE VILLAGE'S OWN
-- pick (plan 5.5). NOT NULL on purpose: a UNIQUE key exempts NULLs, so a
-- nullable column would admit the village's pick of one resource any number
-- of times. `resource_key` is the canvas resources' own key (0224's table,
-- a separate lane); no foreign key, so a pick survives a resource the sheet
-- withdrew, and the export says it is withdrawn.
--
-- ── EXPAND-ONLY, AND THE ROLLBACK IS A NO-OP ───────────────────────────────
--
-- Three new tables, `CREATE TABLE IF NOT EXISTS`, no `ALTER`, no foreign
-- key. The one UNIQUE key is on a table this file creates, so no existing
-- row can violate it. The previous release neither reads nor writes these
-- tables, so putting the old image back leaves the rows where they are.
-- Replaying the file is a no-op. `ENGINE=InnoDB` with no CHARSET clause, so
-- `owner_user_id` and `user_id` join `users.id` in the schema's own collation.

CREATE TABLE IF NOT EXISTS `village_documents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `owner_user_id` varchar(64) NOT NULL,
  `title` varchar(200) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `body` mediumtext NULL,
  `file_name` varchar(255) NULL,
  `file_size` int NULL,
  `shared_with_village` tinyint(1) NOT NULL DEFAULT 0,
  `shared_at` datetime NULL,
  `model_consent_to` varchar(255) NULL,
  `model_consent_at` datetime NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `village_documents_owner` (`owner_user_id`, `created_at`),
  KEY `village_documents_shared` (`shared_with_village`, `created_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `village_document_files` (
  `document_id` bigint NOT NULL,
  `mime` varchar(100) NOT NULL,
  `bytes` mediumblob NOT NULL,
  PRIMARY KEY (`document_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `canvas_resource_picks` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` varchar(64) NOT NULL DEFAULT '',
  `resource_key` varchar(191) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `canvas_resource_picks_one` (`user_id`, `resource_key`)
) ENGINE=InnoDB;
