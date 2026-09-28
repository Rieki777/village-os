-- 0223: anybody in a village may suggest how it answers a canvas block, and
-- the village keeps the human half of its Decision Matrix.
--
-- Plan section 2.3 ("Text-bearing objects", "Three pens"), Wave 3a of the
-- Governance Canvas build. Rye, 2026-09-24: a machine or a member may PROPOSE
-- anything, and a human or a full vote, depending on who holds the power,
-- ADOPTS it. Rye, 2026-09-25: villagers may propose a change to any dial from
-- day one. So a suggestion is a row anybody writes, and what adopting it does
-- is decided by the pen that covers it (shared/powerHands.ts).
--
-- ── canvas_proposals: one row per suggestion, and it is never rewritten ────
--
-- `block_id` names the canvas block (shared/governanceCanvas.ts). `target`
-- says what the suggestion would change: `words` (a brief section, named in
-- `section_id`), `purpose` (the governing purpose statement), `setting` (a
-- setting the block maps to, named in `door`, with its value in
-- `change_json`) or `matrix` (a human row of the Decision Matrix, in
-- `change_json`). `body` is the suggestion in the proposer's words, which is
-- what the village reads.
--
-- `serves_purpose` is the proposer's line on how it serves the governing
-- purpose. It is NULL on every suggestion that only changes wording, and the
-- route asks for it only where the plan scopes it: the power, conflict, roles
-- and resourcing answers and the matrix (GPS ruling 1's scoping).
--
-- `source` is who wrote it: `member`, `derived` (drafted from the live
-- system) or `import`. `status` is `open`, `adopted` or `declined`, and moves
-- once: an adopted or declined row is never reopened, because a changed mind
-- is a new suggestion. `decided_by`, `decision_note` and `decided_at` record
-- who moved it and why. `outcome_json` records what adopting it did, in the
-- words the route answered with (the section written, the setting changed, or
-- the proposal filed), so the record says what happened and not only that
-- something did.
--
-- Every set of words is a varchar, never an enum. Widening a live enum is the
-- forbidden migration class (0019's header), and a varchar lets a later
-- release add a target or a status with no ALTER at all. The route is what
-- holds each column to its words.
--
-- ── decision_matrix_rows: the human columns only ──────────────────────────
--
-- The platform generates the other half of the matrix on every read from the
-- rules it enforces (shared/decisionMatrix.ts) and stores nothing. These rows
-- are what only the village can say: a kind of decision, who approves it, who
-- is consulted, who is told, the method, and the risk tags. Risk tags are
-- information and never law. Written under the consequence pen: the founders
-- before the Birthing, the village's vote after it.
--
-- ── EXPAND-ONLY, AND THE ROLLBACK IS A NO-OP ───────────────────────────────
--
-- Two new tables, `CREATE TABLE IF NOT EXISTS`, one non-unique index each, no
-- `ALTER`, no foreign key. The previous release neither reads nor writes them,
-- so putting the old image back leaves the rows where they are and a
-- re-deploy picks them up again. Replaying the file is a no-op. `ENGINE=InnoDB`
-- with no CHARSET clause, so `proposed_by`, `decided_by` and `updated_by` join
-- `users.id` in the schema's own collation.

CREATE TABLE IF NOT EXISTS `canvas_proposals` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `block_id` varchar(32) NOT NULL,
  `target` varchar(16) NOT NULL DEFAULT 'words',
  `section_id` varchar(64) NULL,
  `door` varchar(64) NULL,
  `change_json` text NULL,
  `body` text NOT NULL,
  `serves_purpose` text NULL,
  `source` varchar(16) NOT NULL DEFAULT 'member',
  `proposed_by` varchar(64) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'open',
  `decided_by` varchar(64) NULL,
  `decision_note` text NULL,
  `outcome_json` text NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_at` datetime NULL,
  PRIMARY KEY (`id`),
  KEY `canvas_proposals_block_status` (`block_id`, `status`, `created_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `decision_matrix_rows` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `subject` varchar(200) NOT NULL,
  `approval` text NOT NULL,
  `consultation` text NOT NULL,
  `information` text NOT NULL,
  `method` varchar(200) NOT NULL DEFAULT '',
  `risk_tags` varchar(500) NOT NULL DEFAULT '',
  `updated_by` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `decision_matrix_rows_updated` (`updated_at`)
) ENGINE=InnoDB;
