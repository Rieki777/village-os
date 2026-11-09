-- 0354: the place registry. Every place on a village's land, from an idea to a
-- building that needs care, kept as a row a member can read and a village can
-- change by its own powers (living places, spec v0.3, S2).
--
-- Claimed in the fleet ledger, section 3, by the integrator for the places lane.
-- New tables only. Nothing here alters, narrows or drops anything that exists,
-- so the previous release runs over a migrated database unchanged.
--
-- THE KEY IS THE MAP'S KEY. `key` is the `structure_key` the living map and
-- `place_photos` (0093) already use, byte for byte. Keys already on a map keep
-- their spelling, including mixed case. New keys are lowercase slugs
-- (shared/places.ts `isPlaceKey`). The database compares without case, so two
-- keys that differ only by case are one key here, which is what
-- `keyCollision` refuses before an insert.
--
-- NO COORDINATES. A place's anchor is read from the published scene, never
-- stored here, so the registry can never invent geography (map rulings).
--
-- No CHARSET clause on any table: they inherit the database's collation,
-- because user ids join `users.id` (the collation-split trap). No foreign
-- keys, house norm. `--` comments sit on their own lines and never end in a
-- semicolon (the 0015 trap). Every column that dedupes is NOT NULL, because a
-- MySQL unique index admits any number of NULLs. No SQL function appears
-- outside the production allow-list (`check-migration-sql`).

-- ── The places themselves ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `places` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `key` varchar(64) NOT NULL,
  `name` varchar(200) NOT NULL,
  -- A `place_zones.key`, or NULL for a place with no zone (the whole land).
  `zone` varchar(64) NULL,
  -- building, homes, garden, system, feature, preserve, land, route.
  `kind` varchar(16) NOT NULL,
  -- One of the nine stages, or NULL for a kind with no lifecycle.
  `stage` varchar(16) NULL,
  `readiness_pct` int NULL,
  -- A proposed match stays unconfirmed until a place.tend holder confirms it,
  -- and an unconfirmed place is drawn dashed at every stage.
  `confirmed` tinyint(1) NOT NULL DEFAULT 0,
  -- The open disputes: [{kind, topic, sources, toSettle}].
  `disputes` json NULL,
  -- Other keys this place has been called. Lookups resolve them; a row is
  -- never re-keyed.
  `aliases` json NULL,
  -- Home units here, for the homes count: {homes, apartments, selfBuildLots, casitas}.
  `units` json NULL,
  `position_text` varchar(500) NOT NULL DEFAULT '',
  `description` text NULL,
  `phase` varchar(32) NULL,
  `is_temporary` tinyint(1) NOT NULL DEFAULT 0,
  `temporary_successor` varchar(64) NULL,
  `set_aside_reason` varchar(500) NULL,
  `retired_at` datetime NULL,
  -- yes, no or unknown. Siting needs both known; a yes needs consent.
  `in_preserve` varchar(8) NOT NULL DEFAULT 'unknown',
  `in_riparian` varchar(8) NOT NULL DEFAULT 'unknown',
  `footprint_m2` int NULL,
  -- Places where children may be. Their events are never sent publicly. No
  -- child's location is ever stored anywhere.
  `child_safe` tinyint(1) NOT NULL DEFAULT 0,
  `hours_window` json NULL,
  `is_home` tinyint(1) NOT NULL DEFAULT 0,
  `showcase` tinyint(1) NOT NULL DEFAULT 0,
  -- The org role that stewards this place, when one is linked. A place with
  -- none is a virtual invitation: a claim proposes the role (S5).
  `steward_role_id` varchar(64) NULL,
  -- {state: held|paused, reason, endsCycle, by}, or NULL.
  `steward_hold` json NULL,
  `claim_window_ends_at` datetime NULL,
  `target_date` varchar(32) NULL,
  `created_by` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `changed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `key`),
  KEY `places_zone_idx` (`village_id`, `zone`),
  KEY `places_steward_idx` (`village_id`, `steward_role_id`)
);

-- ── Zones, in the order a visitor walks them ──────────────────────────────
CREATE TABLE IF NOT EXISTS `place_zones` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `key` varchar(64) NOT NULL,
  `name` varchar(200) NOT NULL,
  `sort` int NOT NULL DEFAULT 0,
  `position_text` varchar(500) NOT NULL DEFAULT '',
  PRIMARY KEY (`village_id`, `key`)
);

-- ── Stage changes: proposed, queued for the moon review, decided ──────────
-- Written from S3. `id` is `psc-` plus 16 hex characters, and build days'
-- `place_photos.stage_transition_id` and `place_log` point at it.
CREATE TABLE IF NOT EXISTS `place_stage_changes` (
  `id` varchar(40) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `key` varchar(64) NOT NULL,
  `from_stage` varchar(16) NULL,
  `to_stage` varchar(16) NOT NULL,
  -- queued, adopted, declined, withdrawn or refused.
  `status` varchar(16) NOT NULL,
  `reason` varchar(1000) NULL,
  -- What asked for it: a quest, a build day, a member.
  `source_ref` varchar(128) NULL,
  -- Whoever approved the source quest. They never adopt this change.
  `source_approver_id` varchar(64) NULL,
  `proposed_by` varchar(64) NOT NULL,
  -- The moon cycle it is queued for, and how many times it has been carried.
  `cycle` varchar(32) NULL,
  `carried` int NOT NULL DEFAULT 0,
  `before_photo_id` varchar(64) NULL,
  `after_photo_id` varchar(64) NULL,
  `decided_by` varchar(64) NULL,
  -- holder, consent, village_vote or highest_vote.
  `decided_via` varchar(16) NULL,
  `ballot_id` varchar(64) NULL,
  `warnings` json NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_at` datetime NULL,
  PRIMARY KEY (`id`),
  KEY `place_stage_changes_place_idx` (`village_id`, `key`, `created_at`),
  KEY `place_stage_changes_queue_idx` (`village_id`, `status`, `cycle`)
);

-- ── The permit checklist ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `place_permits` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `key` varchar(64) NOT NULL,
  `title` varchar(300) NOT NULL,
  -- needed, in_progress, submitted, granted or not_needed.
  `state` varchar(16) NOT NULL,
  -- Required for not_needed (S4).
  `reason` varchar(1000) NULL,
  `upload_id` varchar(64) NULL,
  -- Permit ids this one waits on, often on the whole land.
  `waits_on` json NULL,
  `changed_by` varchar(64) NOT NULL,
  `changed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `id`),
  KEY `place_permits_place_idx` (`village_id`, `key`)
);

-- ── Shared systems serving places, and places that are part of others ─────
CREATE TABLE IF NOT EXISTS `place_links` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `from_key` varchar(64) NOT NULL,
  `to_key` varchar(64) NOT NULL,
  -- serves or part_of.
  `kind` varchar(16) NOT NULL,
  PRIMARY KEY (`village_id`, `from_key`, `to_key`, `kind`),
  KEY `place_links_to_idx` (`village_id`, `to_key`)
);

-- ── Stewardship claims ─────────────────────────────────────────────────────
-- Written from S5. A claim on a linked role is a seat application; on a
-- virtual invitation it is a role proposal. Funds are a statement and never
-- reach a ballot.
CREATE TABLE IF NOT EXISTS `place_steward_claims` (
  `id` varchar(40) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `key` varchar(64) NOT NULL,
  `claimant_user_id` varchar(64) NOT NULL,
  `application_id` varchar(64) NULL,
  `role_proposal_id` varchar(64) NULL,
  `build` varchar(2000) NOT NULL,
  `team` varchar(1000) NOT NULL DEFAULT '',
  `funds_amount_minor` bigint NULL,
  `funds_unit` varchar(32) NULL,
  `funds_note` varchar(1000) NOT NULL DEFAULT '',
  `timeline` varchar(1000) NOT NULL,
  `crews` varchar(1000) NOT NULL DEFAULT '',
  `challenge` tinyint(1) NOT NULL DEFAULT 0,
  -- open, adopted, declined, withdrawn or lapsed.
  `status` varchar(16) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `place_steward_claims_place_idx` (`village_id`, `key`, `status`),
  KEY `place_steward_claims_claimant_idx` (`claimant_user_id`)
);
