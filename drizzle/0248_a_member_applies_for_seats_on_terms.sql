-- 0248: a member applies to hold one to five seats, on terms, as one proposal.
--
-- WHAT THIS IS FOR.
-- Seat settings PR4, the member door. A member picks the seats they would hold,
-- writes what they will have done by the season's end, and sets the terms
-- (shared/seatSettings.ts). Adoption follows whoever holds `org.seat`: a live
-- holder other than the candidate adopts it, or the village votes on it as a
-- `role_application` ballot. One application can carry several seats, so a
-- member holding three seats records their pay, allowance and bonus once.
--
-- WHAT IS WRITTEN AFTER INSERT, AND NOTHING ELSE.
-- `status`, `adopted_via`, `adopted_ref`, `authority_ref` and `decided_at`, by
-- the route and the closer (server/lib/seatApplicationCloser.ts), and `note`
-- and `deliverables`, set to NULL by the erasure step. `settings_json` and the
-- term are never updated: a change of terms is a new application. Raw SQL
-- only, never `dbCollection`, whose `replaceAll` resets omitted columns.
--
-- `starts_at` IS THE EARLIEST INSTANT THE SEATS MAY BE TAKEN UP.
-- NULL means as soon as the application is adopted. An application for next
-- season carries the season's first day, and its adoption records `adopted`
-- and seats nobody: a seating made now would carry next season's id and read
-- as lapsed in this one. A later job seats it on the day through
-- `seatFromApplication`.
--
-- `text_id` and `text_hash` stay NULL until the alignment store lands (PR5).
--
-- `org_role_assignments.application_id` names the application whose terms a
-- seating holds. NULL for every seating made by any other door, which is the
-- honest answer for all of them.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- A new table, and one nullable column with no default on a table whose
-- writers name their own columns (`seatHolder`, the draft apply path, the
-- examples seed). The previous release names neither, so it keeps reading and
-- writing both tables unchanged if it is put back over a migrated database.

CREATE TABLE IF NOT EXISTS `seat_applications` (
  -- 'sa-' and sixteen hex characters.
  `id` varchar(40) NOT NULL,
  `candidate_user_id` varchar(64) NOT NULL,
  -- The member who wrote it. The candidate in v1, where applications are self-applications.
  `proposed_by` varchar(64) NOT NULL,
  -- JSON: one to five `org_roles` ids. One package: money recorded once.
  `seat_ids` json NOT NULL,
  -- Why this member, at most 2000 characters. Members read it on the page; no ballot carries it.
  `note` text NULL,
  -- What will be true at the season's end, at most 2000 characters.
  `deliverables` text NULL,
  -- The parsed settings object. Never updated.
  `settings_json` json NOT NULL,
  `settings_hash` char(64) NOT NULL,
  `text_id` varchar(40) NULL,
  `text_hash` char(64) NULL,
  `term_ends_at` datetime NOT NULL,
  `term_season_id` varchar(64) NULL,
  `term_follows_season` tinyint NOT NULL DEFAULT 0,
  `starts_at` datetime NULL,
  `supersedes_id` varchar(40) NULL,
  -- awaiting-holder, voting, adopted, not-adopted, withdrawn or held-full.
  `status` varchar(20) NOT NULL,
  -- holder or ballot.
  `adopted_via` varchar(8) NULL,
  -- The ballot id, or the adopting holder's user id.
  `adopted_ref` varchar(64) NULL,
  -- 'org.seat@<role id>' for a holder, the ballot id for a vote.
  `authority_ref` varchar(64) NULL,
  `decided_at` datetime NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `seat_applications_candidate_idx` (`candidate_user_id`),
  KEY `seat_applications_status_idx` (`status`)
);

-- Indexed: the in-force derivation, the season turn and the application
-- page all read the seatings carrying an application (red team D8).
ALTER TABLE `org_role_assignments`
  ADD COLUMN `application_id` varchar(40) NULL,
  ADD KEY `org_role_assignments_application_idx` (`application_id`);
