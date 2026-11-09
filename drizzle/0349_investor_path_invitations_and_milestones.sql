-- The investor path's own records (spec v0.3, slice S2).
--
-- New tables and two badge rows, so this file is expand-only: the previous
-- release neither reads nor writes any of it.
--
-- NO AMOUNT COLUMN ANYWHERE, the 0156 doctrine. How much anybody put in lives
-- in the ledger and nowhere else (server/lib/ledger.ts, decision 5 as amended
-- 2026-11-09). These tables say what was offered, who raised a hand, what a
-- person said yes to, and when a home or a parcel changed hands, in words and
-- dates.
--
-- `investor_invitations`: what a village offers, one row per invitation, keyed
-- by its way in (shared/investorPath.ts WAY_KEYS). `status` is open or closed;
-- a closed one says why in `closed_reason` (sold, filled, withdrawn). The
-- concept label is never stored: it is computed from the place's stage at read
-- time (`isConcept`), so it cannot go stale when the place moves.
CREATE TABLE IF NOT EXISTS `investor_invitations` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `way` varchar(32) NOT NULL,
  `title` varchar(160) NOT NULL,
  `body` text NULL,
  `place_ref` varchar(64) NULL,
  `status` varchar(16) NOT NULL DEFAULT 'open',
  `closed_reason` varchar(32) NULL,
  `created_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `investor_invitations_way_idx` (`village_id`, `way`, `status`)
);

-- Every change to an invitation, append-only, so a closed one keeps the story
-- of who closed it and when. `at` keeps milliseconds so two changes in the
-- same second still read back in the order they happened.
CREATE TABLE IF NOT EXISTS `investor_invitation_history` (
  `id` varchar(64) NOT NULL,
  `invitation_id` varchar(64) NOT NULL,
  `change` varchar(32) NOT NULL,
  `detail` varchar(500) NULL,
  `changed_by` varchar(64) NULL,
  `at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `investor_invitation_history_inv_idx` (`invitation_id`, `at`)
);

-- A raised hand. One OPEN hand per person per way: `open_key` holds
-- "{user}:{way}" while the hand is open and NULL once it is withdrawn or
-- closed, and MySQL's unique index exempts NULLs, so the database refuses the
-- second open hand and allows any number of finished ones. `moon` is the
-- village month the hand was raised in, which is what the per-moon limit
-- (`handVerdict`) counts.
CREATE TABLE IF NOT EXISTS `investor_intents` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `user_id` varchar(64) NOT NULL,
  `way` varchar(32) NOT NULL,
  `invitation_id` varchar(64) NULL,
  `status` varchar(16) NOT NULL DEFAULT 'open',
  `routed_kind` varchar(16) NULL,
  `routed_ref` varchar(64) NULL,
  `moon` char(7) NOT NULL,
  `open_key` varchar(160) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `investor_intents_open_uq` (`village_id`, `open_key`),
  KEY `investor_intents_user_idx` (`village_id`, `user_id`, `moon`)
);

-- What a person said yes to (S4 writes these). `money_in_id` is the one
-- economics record the investor confirms, and `signed_by` is the finance lead
-- or Treasurer who signed it off (Rye, 2026-11-09).
CREATE TABLE IF NOT EXISTS `investor_commitments` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `intent_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `money_in_id` varchar(64) NULL,
  `status` varchar(24) NOT NULL DEFAULT 'awaiting_yes',
  `confirmed_at` timestamp NULL,
  `signed_by` varchar(64) NULL,
  `signed_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `investor_commitments_money_uq` (`money_in_id`),
  KEY `investor_commitments_user_idx` (`village_id`, `user_id`)
);

-- A home handed over to its owner, with its 99-year land lease. Housing has
-- no handed-over state (its reservations end at reserved), so this lane
-- records it. One handover per home: `home_ref` is unique per village.
CREATE TABLE IF NOT EXISTS `investor_home_handovers` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `home_ref` varchar(64) NOT NULL,
  `reservation_id` varchar(64) NULL,
  `user_id` varchar(64) NOT NULL,
  `recorded_by` varchar(64) NOT NULL,
  `handed_over_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `investor_home_handovers_home_uq` (`village_id`, `home_ref`),
  KEY `investor_home_handovers_user_idx` (`user_id`)
);

-- A parcel sold. One sale per parcel invitation. `user_id` is NULL for a sale
-- made before the platform knew the buyer (a parcel already sold when the
-- village started recording), which earns nobody a badge.
CREATE TABLE IF NOT EXISTS `investor_parcel_sales` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `invitation_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NULL,
  `recorded_by` varchar(64) NOT NULL,
  `sold_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `investor_parcel_sales_inv_uq` (`invitation_id`),
  KEY `investor_parcel_sales_user_idx` (`user_id`)
);

-- THE TWO BADGES (Rye, 2026-11-09: build them now). Earned, counted by the
-- metrics `homes_handed_over` and `parcels_bought` (server/lib/badges.ts), and
-- awarded at the moment the record is made (`awardFirstTierNow`). They carry no
-- power and no multiplier. INSERT IGNORE so a village that already made a
-- badge with either id keeps theirs.
INSERT IGNORE INTO `badges` (`id`, `name`, `description`, `icon`, `kind`, `capabilities`, `denies`, `rule`, `active`)
VALUES (
  'homeowner',
  'Homeowner',
  'Holds a home in the village on its 99-year land lease.',
  'home',
  'earned',
  '[]',
  NULL,
  '{"metric":"homes_handed_over","threshold":1}',
  1
);

INSERT IGNORE INTO `badges` (`id`, `name`, `description`, `icon`, `kind`, `capabilities`, `denies`, `rule`, `active`)
VALUES (
  'neighbour',
  'Neighbour',
  'Bought a parcel of land beside the village.',
  'map-pin',
  'earned',
  '[]',
  NULL,
  '{"metric":"parcels_bought","threshold":1}',
  1
);
