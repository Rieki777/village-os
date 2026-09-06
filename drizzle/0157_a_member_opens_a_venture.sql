-- 0157: the thing a prosperity creator actually creates, recorded once, with
-- the dates that make a ladder position derivable from it.
--
-- ── WHY THIS IS PLATFORM AND NOT A NEW MODULE ────────────────────────────
-- The profile copy this replaces told members that venture details "arrive
-- with the prosperity module". There is no prosperity module. shared/modules.ts
-- is THE registry and every id in it is a real, shipped module; none of them
-- is this. So the promise pointed at something nobody had designed, and the
-- question this file had to answer first was whether to design it now.
--
-- It should not be a module, for four reasons, in the order they decide it:
--
--  1. THE PATHS ARE ALREADY PLATFORM IDENTITY. All four of them live in
--     GAME_CONFIG.paths in shared/gameConfig.ts, which is the brand overlay
--     plane, and their pages are platform routes. A module is a different
--     plane entirely (module_settings, lifecycle, requireModule).
--  2. A MODULE CAN BE SWITCHED OFF AND THESE FOUR CANNOT. Every non-core
--     module ships OFF and an absent module_settings row means off. Put one
--     of the four paths behind a module and a village that never turns it on
--     has three ladders and a hole where the fourth belongs, on a profile
--     page that promises four. The other three ladders read
--     org_role_assignments, housing_reservations and the table 0156 adds,
--     none of which is behind a module either.
--  3. PROFILES IS CORE, WHICH IS EXACTLY THE RIGHT HOME. It is one of the
--     four modules that are always public and cannot be disabled, and a
--     member's standing on their own path is profile material by definition.
--  4. A MODULE IS A CONTRACT AND THIS BUYS NONE OF IT. A registry entry
--     commits to catalog copy, a group, a tier, a data class, a setup class,
--     a health declaration, a docs page, dependency demotion at boot and the
--     module-review workflow. Every one of those exists to describe a
--     connection to an outside paid service. There is no vendor here, no
--     credential, no API and no bill, so a listing would be ceremony with
--     nothing behind it.
--
-- So: plain platform, owned by the core profiles module, and the promise
-- becomes redeemable now instead of waiting on a module that was never
-- specified.
--
-- ── FACTS WITH DATES, NEVER A RUNG ───────────────────────────────────────
-- The obvious shape for this table is a `stage` or `level` column reading
-- something like idea | trading | established, and that column is exactly
-- what this design refuses. A stored position has to be maintained by
-- somebody, it survives the fact that justified it, and there is no way to
-- tell a stale one from a true one by looking.
--
-- So the table stores DATES instead, one per thing that happened, and the
-- ladder is a function of which of them are set and which are still live:
--
--   opened_at   the day the venture started. Never NULL: a venture that has
--               not started is not a venture.
--   listed_at   the day it was published to the village, which is a
--               different act from opening it. NULL means it exists and the
--               village has not been told.
--   closed_at   the day it stopped. NULL means it is running, and this is
--               the column that makes a rung FALL: close the venture and the
--               next read of the prosperity ladder finds nothing live and
--               answers lower, with nobody writing an update anywhere.
--
-- The precedent is computeStage in server/index.ts, which reads quests,
-- membership and training every time instead of storing a stage. Nothing
-- here stores a position, so nothing here can lie about one.
--
-- History survives a close for the same reason it does in 0156 and in
-- org_role_assignments (0049): the row stays, carrying its dates and its
-- reason. A closed venture is still a thing a member did, and reading it
-- back means reading this table without the live filter. That is why there
-- is no separate crossing-event table beside this one; the interval columns
-- already hold what such a log would hold, and a log would additionally have
-- to write down a rung, which is the one thing this design will not do.
--
-- ── SHAPE ────────────────────────────────────────────────────────────────
-- varchar and not enum for `kind`, matching 0077's taken_source and 0060's
-- address_source: the set grows by a village typing one, an enum change is a
-- table rebuild, and removing an enum value is forbidden by the compat rule.
--
-- No CHARSET clause. This joins to `users`.`id`, and `users` (0001) inherits
-- the schema default; pinning utf8mb4 on one side of that join is what
-- produces the cross-era collation mismatch. 0049, 0122 and 0123 inherit for
-- the same reason.
--
-- No money column, and the reason is 0156's reason applied here: revenue,
-- valuation and any figure about what a venture is worth belong to whatever
-- system actually holds them, and a member-editable number about value
-- sitting on a profile is a claim the platform cannot stand behind.
--
-- ── EXPAND, NEVER CONTRACT ───────────────────────────────────────────────
-- A new table. The previous release has never heard of it and runs unchanged,
-- and the UNIQUE key is legal because it is born with the table rather than
-- imposed on rows that already exist.

CREATE TABLE IF NOT EXISTS `member_ventures` (
  `id` varchar(64) NOT NULL,
  -- Same scope column every table in the 0069+ sequence carries.
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  -- NOT NULL. A venture belongs to the member who runs it; that is the whole
  -- reason this table exists rather than a row in a generic list.
  `user_id` varchar(64) NOT NULL,
  `name` varchar(190) NOT NULL,
  `summary` varchar(500) NULL,
  -- What sort of venture: free words the village chooses, never a fixed set.
  `kind` varchar(48) NULL,
  -- Where to find it. NULL is ordinary: plenty of ventures have no web page.
  `link` varchar(1000) NULL,
  `opened_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Published to the village. A separate act from opening, so a separate
  -- date, so a ladder can tell the two apart.
  `listed_at` timestamp NULL,
  -- NULL means running. This is the column a rung falls on.
  `closed_at` timestamp NULL,
  `closed_reason` varchar(160) NULL,
  -- Standing-example row: display only, never counted by a ladder. Same
  -- column and same hazard as org_role_assignments and 0156.
  `is_example` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `active_venture_key` varchar(255) AS (IF(`closed_at` IS NULL, CONCAT(`user_id`, ':', `name`), NULL)) STORED,
  PRIMARY KEY (`id`),
  -- One live venture of one name per member per village, so a double-pressed
  -- button fails its second INSERT instead of listing the same venture twice.
  -- The generated key uses MySQL's NULL exemption on purpose: once a venture
  -- closes its key goes NULL, so a member may open one under the same name
  -- again later without colliding with their own history.
  UNIQUE KEY `member_ventures_active_uq` (`village_id`, `active_venture_key`),
  -- The ladder read: one member's ventures, live ones first by the filter.
  KEY `member_ventures_user_idx` (`village_id`, `user_id`, `closed_at`),
  -- The village read: everything currently listed, newest first.
  KEY `member_ventures_listed_idx` (`village_id`, `listed_at`)
);
