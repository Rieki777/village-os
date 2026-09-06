-- A vendor record can be about more than one person, and until now only the
-- first of them survived the door.
--
-- `external_proposals.subject_ref` is a single varchar. The work order
-- publishes `subject_refs` as an ARRAY, and the importer mapped
-- `subject_refs[0]` and dropped the rest silently. So a risk naming two
-- members was a record about ONE member as far as anything keyed on the
-- subject is concerned.
--
-- ── WHY THAT IS A LEAVING-WELL PROBLEM AND NOT A TIDINESS ONE ────────────
--
-- `GET /api/profile/export` promises everything the village holds about a
-- member. `anonymizeMember` sweeps roughly thirty tables so a departure is
-- real. `shared/constitution.ts` publishes "Leaving well is guaranteed" on a
-- public page. A dropped subject reference makes all three quietly false for
-- the second person named: their export never finds the row, their erasure
-- never clears it, and it survives their departure holding a verbatim quote
-- about them.
--
-- It is also the direction that cannot be repaired later. The dropped
-- references were never written anywhere, so a column widened in six months
-- has nothing to backfill from. This is cheap now and impossible later.
--
-- ── `member_id` IS THE ATTRIBUTION, AND NULL IS AN HONEST ANSWER ─────────
--
-- A vendor sends its own opaque reference. This village can only act on a
-- subject it can RESOLVE, so each reference is looked up once, at landing,
-- and the answer is stored beside it. A row whose `member_id` is NULL is a
-- record this village cannot attribute to anybody, which is a fact a steward
-- and an erasure report both need to be able to see. The alternative, an
-- export that silently returns nothing, is the failure `memberDrivers.ts`
-- exists to prevent: silence is not confirmation.
--
-- `subject_ref` is KEPT on `external_proposals` and still carries the first
-- reference. Expand, never contract: the previous release reads that column
-- and must keep working after a rollback.
--
-- ── NO FOREIGN KEYS, FOR THE REASONS 0140 GIVES ─────────────────────────
--
-- A new FOREIGN KEY on an existing table is on this repository's
-- never-in-the-same-release list, and the point of a landing table is that it
-- keeps a row whose reference does not resolve rather than losing it to a
-- constraint. `member_id` is nullable for the same reason.
--
-- Charset is inherited rather than pinned, matching 0140, so the join between
-- these two tables cannot land on either side of the collation split.

CREATE TABLE IF NOT EXISTS `external_proposal_subjects` (
  `id` varchar(64) NOT NULL,
  `proposal_id` varchar(64) NOT NULL,
  `subject_ref` varchar(200) NOT NULL,
  `member_id` varchar(64) NULL,
  `position` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `eps_one_ref_per_proposal` (`proposal_id`, `subject_ref`),
  KEY `eps_proposal_idx` (`proposal_id`),
  KEY `eps_member_idx` (`member_id`),
  KEY `eps_ref_idx` (`subject_ref`)
) ENGINE=InnoDB;

-- Backfill the single reference every existing row already carries, so the
-- new table is the whole truth from the first release rather than only for
-- records that arrive after it. Scoped by a WHERE, per the migration rules.
INSERT IGNORE INTO `external_proposal_subjects` (`id`, `proposal_id`, `subject_ref`, `member_id`, `position`)
SELECT CONCAT('eps-', `id`), `id`, `subject_ref`, NULL, 0
FROM `external_proposals`
WHERE `subject_ref` IS NOT NULL AND `subject_ref` <> '';
