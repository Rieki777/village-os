-- 0186: what this village is for, and what meets it. (R1, R18, R20; lane N1)
--
-- R1, the founder's words: "let's work out the UX for identifying the scope of
-- needs and the totality of needs the village aims to meet. Setting this goal
-- up front helps orient the scope and scale the village needs to operate at
-- (meeting 10% of the needs of members versus 100% are 2 very different
-- economic engines)". R18: "the more needs you're trying to meet the more
-- roles you need in your economy to help meet all the needs!"
--
-- WHAT THE CODE DID BEFORE THIS FILE. Nothing. Every CREATE TABLE in drizzle/
-- was enumerated and none was named needs, need_*, goals, targets, coverage or
-- taxonomy. The nearest object was `shared_items` (0031), whose `type` column
-- ships the value 'need', and that is a federation publish frame with a title,
-- a detail and a status: no depth, no breadth, no link to any quest or seat.
--
-- TWO TABLES IN ONE FILE, because they are one object. A scope with nothing
-- tagged to it and a tag with no scope are both meaningless, and splitting
-- them would let a deployment sit for one release with half the answer.
--
-- NO FOREIGN KEYS. This schema has zero of them on purpose. `need_links`
-- carries indexed columns and the store reconciles, the way every other table
-- here does.
--
-- THE TAXONOMY IS NOT IN THIS FILE. The ten needs, their expressions and the
-- five rungs live in shared/needs.ts, modelled on shared/capitals.ts, because
-- they are platform copy. A village that disagrees adds a custom row below
-- instead of editing platform data.
--
-- NO village_id COLUMN, and this was a decision. The economy tables (0069 to
-- 0072, 0123, 0125, 0140) carry `village_id varchar(64) NOT NULL DEFAULT
-- 'local'` so that idempotency keys and money queries carry the scope from the
-- first day. The coordination tables this one sits beside carry none:
-- `org_roles` and `org_role_assignments` (0049), `quests` (0001), `circles`,
-- `events`, `health_snapshots` (0026). A need scope is coordination and never
-- moves value (see server/lib/needs.ts on why a link is a description), so it
-- is filed with the second group. The design this was built from
-- (section A.1.2) specifies the same shape.

-- One row per need this village has taken on, platform or custom.
CREATE TABLE IF NOT EXISTS `village_needs` (
  `id` varchar(64) NOT NULL,
  -- A `HUMAN_NEEDS` id from shared/needs.ts, or `custom:<slug>`. The prefix is
  -- what makes it impossible for a village's own need to take a platform id:
  -- ':' appears in no platform id, so the two key spaces cannot collide.
  `need_key` varchar(64) NOT NULL,
  -- COPIED from the taxonomy at adoption, never joined. A later platform
  -- rename of a need must not silently rewrite what this village said it was
  -- for. Same reasoning exitPolicy.ts uses about platform words.
  `label` varchar(120) NOT NULL,
  `is_custom` tinyint(1) NOT NULL DEFAULT 0,
  -- How far this village means to get on this need. The five rungs are the
  -- deck's own ladder, stored lowest first so that ORDER BY FIELD and the
  -- shared array agree.
  `depth_target` enum('deprived','unmet','alive','satisfied','thriving') NOT NULL DEFAULT 'satisfied',
  -- The share of the members this need is aimed at. Childcare may be for the
  -- four families with children; clean water is for everyone.
  `breadth_target_pct` int NOT NULL DEFAULT 100,
  -- Why this village took it on, in its own words.
  `note` text NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `adopted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- A NEED IS RETIRED, NEVER DELETED, and there is no second `active` column
  -- saying the same thing. Whether a need is in scope is DERIVED from this one
  -- field, the way org_roles derives vacancy instead of storing a status. Two
  -- columns for one fact is how a row comes to be active and retired at once.
  -- Retiring rather than deleting also keeps the health snapshots readable:
  -- a closed cycle's snapshot is frozen forever and never recomputed, so a
  -- metric key naming a deleted need would have nothing to render against.
  `retired_at` timestamp NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- NOT NULL on both halves. MySQL unique indexes exempt NULLs, so a nullable
  -- column in a dedupe key admits unlimited duplicates.
  UNIQUE KEY `village_needs_key_uq` (`need_key`),
  KEY `village_needs_live_idx` (`retired_at`, `sort_order`)
);

-- The tag on the thing that meets a need.
--
-- WHY A LINK TABLE AND NOT A COLUMN ON EACH THING. Five tables would need five
-- columns, five backfills and five editors, and one of the five subjects is
-- not a row at all: a spend sink is a decision that `spendSurfacesFor` counts
-- live in server/lib/spending.ts. A link table also lets one quest serve two
-- needs, which the deck's expressions make ordinary: a food forest build day
-- is Vitality and Contribution and Play at once.
CREATE TABLE IF NOT EXISTS `need_links` (
  `id` varchar(64) NOT NULL,
  -- `village_needs.id`, reconciled by the store. No foreign key, house norm.
  `need_id` varchar(64) NOT NULL,
  `subject_type` enum('quest','role','sink','stay','event','place') NOT NULL,
  -- The quest id, the `org_roles` id, a token slug for a sink, and so on.
  `subject_ref` varchar(120) NOT NULL,
  -- Whether this alone meets the need, or contributes to it. Two words and
  -- not a number: a percentage on a tag invites arithmetic nobody agreed on.
  `weight` enum('primary','partial') NOT NULL DEFAULT 'primary',
  `created_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- One thing is tagged to one need once. All three columns are NOT NULL, so
  -- the NULL exemption cannot open the key.
  UNIQUE KEY `need_links_uq` (`need_id`, `subject_type`, `subject_ref`),
  -- Reading every need one quest meets, which is the editor's question.
  KEY `need_links_subject_idx` (`subject_type`, `subject_ref`),
  KEY `need_links_need_idx` (`need_id`, `weight`)
);
