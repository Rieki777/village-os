-- OPEN ROLE PROPOSALS: somebody with no account proposes to hold roles next
-- season, through the village's public link or a link made for them (master
-- coordinator 2026-10-31 for Rye, calls 1 to 3 and sheet 19i).
--
-- No account is made for them until a proposal is adopted. Until then the
-- proposal is this row: what they typed, and where it stands. Nothing
-- unconfirmed reaches a person: a row stays unconfirmed until its address
-- answers the confirmation email, and an unconfirmed row is deleted after
-- 48 hours. A declined or withdrawn row loses its name and address after
-- 90 days (server/lib/openProposalsTidy.ts).
--
-- Two new tables, nothing altered: expand only.

CREATE TABLE IF NOT EXISTS `open_role_proposals` (
  `id` varchar(24) NOT NULL,
  -- What they typed. Both NULL once the row is anonymised.
  `name` varchar(120) NULL,
  `email` varchar(254) NULL,
  -- The address folded for matching, NULL once anonymised.
  `email_key` varchar(254) NULL,
  -- unconfirmed, confirmed, adopted, declined or withdrawn.
  `status` varchar(16) NOT NULL DEFAULT 'unconfirmed',
  `target_season_id` varchar(64) NULL,
  -- The roles, their words and the season aim (shared/openProposals.ts).
  `body_json` json NULL,
  -- The hash of the confirmation token. Cleared once it is used.
  `confirm_hash` varchar(64) NULL,
  -- The per-person link it came through, NULL for the public link.
  `link_id` varchar(24) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmed_at` timestamp(3) NULL,
  `decided_at` timestamp(3) NULL,
  `anonymised_at` timestamp(3) NULL,
  PRIMARY KEY (`id`),
  KEY `open_role_proposals_status_idx` (`status`, `created_at`),
  KEY `open_role_proposals_email_idx` (`email_key`, `status`),
  KEY `open_role_proposals_confirm_idx` (`confirm_hash`)
);

-- A link made for one person, which an admin can switch off.
CREATE TABLE IF NOT EXISTS `open_proposal_links` (
  `id` varchar(24) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  -- Who it is for, in the admin's own words. Never shown to anybody else.
  `label` varchar(120) NOT NULL,
  `created_by` varchar(64) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revoked_at` timestamp(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `open_proposal_links_token_uq` (`token_hash`)
);
