-- 0273: a member drafts their roles for next season.
--
-- Two new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes them, and rolling an image back over a
-- migrated database leaves two tables nobody asks about. No ALTER, no ADD
-- COLUMN, no backfill.
--
-- THE CONTRACT IS shared/roleProposals.ts. What a draft holds, its limits and
-- every sentence a member reads are named there once; the store
-- (server/repos/roleProposals.ts) writes and reads these rows and nothing else
-- does.
--
-- WHY A TABLE OF ITS OWN, AND NOT A DRAFT STATUS ON `seat_applications`. An
-- application row is what the village decides on: after it is written only its
-- status moves, and a dozen readers list it (the waiting rows, the player card,
-- the season plan page, the season turn, erasure). A draft is the opposite: the
-- member rewrites it as often as they like and nobody else may see it. Putting
-- drafts in that table would make every one of those readers learn to skip
-- them, and its `term_ends_at` is NOT NULL, which a draft does not have yet.
-- So a draft lives here, and SUBMITTING it writes an ordinary application
-- through the member door, whose id is then kept in `application_id`.
--
-- `body_json` holds the draft as the contract shapes it: the roles it names,
-- the words changed on each (only the changed ones, keyed by the field name an
-- `update_seat` draft takes, so a role field added later passes through), any
-- new roles with the words a `create_seat` draft takes, the terms, a review
-- date per role, and the member's season words.
--
-- `target_season_id` is the season the draft is for, next season by the
-- village's own calendar. NULL while next season's dates are not set.
--
-- THE SHARE LINK. `share_token` is 192 random bits, NULL when sharing is off.
-- Turning it off clears it and making a new one replaces it, so an old link
-- reads nothing. It is kept as written, not hashed, so the owner can copy the
-- link again; only the owner's own reads return it. `share_audience` is
-- members (signed-in members with the link) or anyone (read only, no terms).
-- A UNIQUE key over a nullable column admits any number of NULLs, which is
-- exactly "off" for every draft not shared.
--
-- COMMENTS are a member's feedback on a shared draft, at most 1000
-- characters. `author_id` goes NULL when the member who wrote it leaves the
-- village (server/lib/erasure.ts), so the words stay with the draft and name
-- nobody.
--
-- Every instant here is written from Node's clock and read back with
-- UNIX_TIMESTAMP(col), so the database's own zone never moves one. They keep
-- milliseconds, so two comments written in the same second still read in the
-- order they were written; a comment's id starts with its time for the same
-- reason.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `role_proposals` (
  `id` varchar(24) NOT NULL,
  -- The member whose proposal it is. Only they read it until it is submitted.
  `user_id` varchar(64) NOT NULL,
  -- draft or submitted.
  `status` varchar(16) NOT NULL DEFAULT 'draft',
  `target_season_id` varchar(64) NULL,
  `body_json` json NULL,
  `share_token` varchar(64) NULL,
  -- members or anyone.
  `share_audience` varchar(16) NOT NULL DEFAULT 'members',
  -- The `seat_applications` row submitting wrote.
  `application_id` varchar(24) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `submitted_at` timestamp(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_proposals_share_token_uq` (`share_token`),
  KEY `role_proposals_owner_idx` (`user_id`, `status`),
  KEY `role_proposals_application_idx` (`application_id`)
);

CREATE TABLE IF NOT EXISTS `role_proposal_comments` (
  `id` varchar(24) NOT NULL,
  `proposal_id` varchar(24) NOT NULL,
  -- Who wrote it. NULL once they have left the village.
  `author_id` varchar(64) NULL,
  `body` varchar(1000) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `role_proposal_comments_proposal_idx` (`proposal_id`, `created_at`),
  KEY `role_proposal_comments_author_idx` (`author_id`)
);
