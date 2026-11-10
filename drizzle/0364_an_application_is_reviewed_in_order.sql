-- 0364: an application is reviewed in order, and the review is kept apart.
--
-- Role journey lane L5 (review, interviews and selection). Rye, 9 Nov 2026,
-- answer 7: each role names an ORDERED list of interviewing roles, each with its
-- own minutes, one of them marked the final approval; the next is asked only
-- after the previous has scored.
--
-- One application ref covers both doors: an open proposal (`op-...`) and a
-- member's role application (`sa-...`). The ref is the application's own id, so
-- nothing is minted and no column here holds a foreign key.
--
-- ── application_steps ────────────────────────────────────────────────────
-- Stamped once per (ref, kind, subject): confirmed, first_reply, interview (the
-- subject is the position), scores_in, consent, decided. `detail_json` on the
-- `confirmed` step keeps the criteria as they stood at confirm, and a hash of
-- the applicant's status link; never the link itself.
--
-- ── application_interviews ───────────────────────────────────────────────
-- The role's interviewers, copied at confirm so a later edit to the role never
-- moves an application already in flight. `state` is waiting, open, scored or
-- skipped. Only one is open at a time.
--
-- ── application_scores ───────────────────────────────────────────────────
-- One row per criterion per scorecard: four levels and one line of evidence.
-- PRIVATE. Never on a ballot, never public, never shown to the applicant, and
-- read by no companion or guide tool (server/lib/applicationReview.refusal.test.ts).
--
-- ── application_recusals ─────────────────────────────────────────────────
-- One click, recorded: a person who stepped out of an application.
--
-- Four new tables, `CREATE TABLE IF NOT EXISTS`, no ALTER, no foreign key. The
-- UNIQUE keys sit on tables this file creates, so no existing row can break
-- them. The previous release neither reads nor writes these tables, so putting
-- the old image back leaves the rows where they are. Replaying the file is a
-- no-op. `ENGINE=InnoDB` with no CHARSET clause, so user ids join `users.id`
-- in the schema's own collation. Instants are `timestamp(3)`, written from
-- Node's clock and read back with UNIX_TIMESTAMP.

CREATE TABLE IF NOT EXISTS `application_steps` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `application_ref` varchar(64) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `subject` varchar(32) NOT NULL DEFAULT '',
  `stamped_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actor_user_id` varchar(64) NULL,
  `detail_json` text NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `application_steps_once` (`application_ref`, `kind`, `subject`),
  KEY `application_steps_kind` (`kind`, `stamped_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `application_interviews` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `application_ref` varchar(64) NOT NULL,
  `position` int NOT NULL,
  `interviewer_role_id` varchar(64) NOT NULL,
  `minutes` int NOT NULL DEFAULT 20,
  `is_final` tinyint(1) NOT NULL DEFAULT 0,
  `state` varchar(12) NOT NULL DEFAULT 'waiting',
  `scorer_user_id` varchar(64) NULL,
  `opened_at` timestamp(3) NULL,
  `booked_at` timestamp(3) NULL,
  `held_at` timestamp(3) NULL,
  `scored_at` timestamp(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `application_interviews_order` (`application_ref`, `position`),
  KEY `application_interviews_open` (`state`, `interviewer_role_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `application_scores` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `application_ref` varchar(64) NOT NULL,
  `interview_id` bigint NOT NULL,
  `scorer_user_id` varchar(64) NOT NULL,
  `criterion_id` varchar(40) NOT NULL,
  `level` varchar(12) NOT NULL,
  `evidence` varchar(300) NOT NULL,
  `submitted_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `application_scores_one` (`interview_id`, `scorer_user_id`, `criterion_id`),
  KEY `application_scores_ref` (`application_ref`, `scorer_user_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `application_recusals` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `application_ref` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `interview_id` bigint NULL,
  `reason` varchar(300) NULL,
  `stepped_out_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `application_recusals_one` (`application_ref`, `user_id`)
) ENGINE=InnoDB;
