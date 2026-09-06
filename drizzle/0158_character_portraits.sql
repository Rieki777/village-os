-- 0158: a member's OWN portrait for a class, from two sources, private by default.
--
-- ── WHAT THIS DELIBERATELY LOOSENS, AND HOW IT PAYS FOR IT ───────────────
--
-- 0069 closed a door on purpose and said why twice. On `player_characters`:
-- "Enums, and that is the point: presentation and tone are rendered into an
-- avatar filename through a fixed lookup map, so the set of values they can
-- ever hold is closed at the schema and not at the caller." On the archetype
-- `sigil` column: "Not a file path: a path in a data column is a path somebody
-- can point anywhere."
--
-- Both are still true, and neither is weakened here. What 0069 closed is the
-- set of strings that can be CONCATENATED INTO a path. This table stores no
-- path and no URL. It stores a filename that `server/lib/uploads.ts` minted
-- itself through `stampedName`, and the serving side rebuilds the address as
-- `/api/uploads/` plus that name. A caller never supplies the string and never
-- supplies any part of it, so there is nothing here for a caller to point
-- anywhere. The thirty-avatar lookup map in `server/lib/characters.ts` is
-- untouched and still answers for every member who has not made their own.
--
-- The bytes come through the strip either way: `scripts/check-upload-strip.mjs`
-- fails the build if anything reaches the volume without it, and the encode in
-- `server/lib/characterPortraits.ts` re-reads its own output and throws if any
-- metadata survived.
--
-- ── ONE ROW PER MEMBER PER CLASS, THE SAME WAY 0069 DID IT ───────────────
--
-- `character_portraits_one_per_class` is `player_characters_one_per_class`
-- with a different table name, for the same reason: without it a double tap on
-- "Use this one" puts two portraits on one card and nothing says which wins.
-- All three columns in the key are NOT NULL, because a MySQL UNIQUE index
-- exempts NULLs and a nullable column in a dedupe key admits infinite
-- duplicates.
--
-- The row exists for a (member, class) pair whether the picture was forged or
-- uploaded. `source` is the ONLY thing that differs between the two, which is
-- what stops this becoming two storage shapes that drift apart.
--
-- ── WHY `file_name` IS NULLABLE AND `candidate_file_name` EXISTS ─────────
--
-- A forge shows the member a candidate and asks them to keep it or discard it.
-- That candidate is not yet their portrait, and it must not be, or a discard
-- would have to undo a live row on the profile of somebody who never said yes.
-- So the candidate is a SECOND POINTER ON THE SAME ROW rather than a second
-- record: the row is still one per member per class, keeping is one UPDATE
-- moving one column into another, and discarding is one UPDATE clearing it.
--
-- A row can therefore hold a candidate and no portrait, which is why
-- `file_name` is nullable. Readers treat a NULL `file_name` as "this member
-- has no portrait for this class" and fall through to the stock art, which is
-- the same branch a member with no row at all takes.
--
-- ── PRIVATE UNTIL AN EXPLICIT ACT, AND THAT IS ALSO THE MODERATION ANSWER ─
--
-- `published_at` is NULL on every row this schema can create. There is no
-- DEFAULT that could make a portrait public and no write path that sets it
-- except the member's own publish. A bad upload is therefore visible to its
-- uploader and to nobody else, which is why this feature ships with no
-- moderation queue: there is no audience to protect until the member chooses
-- to have one.
--
-- A timestamp and not a boolean, because the boolean is derivable from it and
-- the date is not derivable from the boolean. Somebody asking "when did this
-- go public" gets an answer instead of a shrug.
--
-- ── NO CHARSET CLAUSE, ON PURPOSE ───────────────────────────────────────
--
-- `server/db/collation.ts` records what a pinned `DEFAULT CHARSET=utf8mb4`
-- cost: 0069 through 0072 pinned it, MySQL 8 read the CHARACTER SET's own
-- default rather than the database's, and any join across that boundary died
-- with ER_CANT_AGGREGATE_2COLLATIONS on every deployment whose default was not
-- utf8mb4_0900_ai_ci. `player_characters` is one of the four joins it names.
-- These two tables name no charset, so they inherit the schema default and sit
-- on the same side as the other thirty-five. Nothing here joins
-- `player_characters` or `users` in SQL either: the party and the portraits are
-- read separately and merged in TypeScript by archetype key.

CREATE TABLE IF NOT EXISTS `character_portraits` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `user_id` varchar(64) NOT NULL,
  `archetype_key` varchar(64) NOT NULL,
  -- The pointer into the uploads volume. A filename `stampedName` minted, and
  -- never a caller-supplied path or URL. NULL means the member has a candidate
  -- waiting and has kept nothing yet.
  `file_name` varchar(160) NULL DEFAULT NULL,
  -- A forged picture the member has not yet accepted. Cleared by keeping it,
  -- which moves it into `file_name`, or by discarding it.
  `candidate_file_name` varchar(160) NULL DEFAULT NULL,
  `candidate_at` timestamp NULL DEFAULT NULL,
  -- The two sources, closed at the schema. An upload and a forge produce the
  -- same row and differ here and nowhere else.
  `source` enum('forged','uploaded') NOT NULL DEFAULT 'uploaded',
  -- NULL is private, and NULL is the only state this schema can create.
  `published_at` timestamp NULL DEFAULT NULL,
  `width` int NULL DEFAULT NULL,
  `height` int NULL DEFAULT NULL,
  `bytes` int NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `character_portraits_one_per_class` (`village_id`, `user_id`, `archetype_key`),
  KEY `character_portraits_user_idx` (`village_id`, `user_id`)
) ENGINE=InnoDB;

-- The forge budget, one row per member, and the reason it is not a balance
-- a scheduler tops up.
--
-- ── TWO COUNTERS, BECAUSE THE RULE HAS TWO HALVES ───────────────────────
--
-- Three generations are granted at profile setup and BANK: unused ones never
-- expire and there is no ceiling on them. Then one arrives each moon, and that
-- half DOES have a ceiling of three, so nobody returns after a year with
-- twelve. One counter cannot hold both rules, because the ceiling has to apply
-- to the moon half and must not eat the setup half a member deliberately saved.
--
-- ── ACCRUAL IS LAZY AND KEYED ON THE LUNATION NUMBER ────────────────────
--
-- `moon_cycle` is the absolute lunation number the moon half was last brought
-- up to, which is the same storage key `gratitude-cycles.ts` insists on and
-- never the village's own ordinal. Reading the budget advances it: the read
-- computes `min(3, held + elapsed)` and writes the new cycle in one statement
-- guarded by `moon_cycle < ?`, so two processes reading at once cannot grant
-- twice and no scheduler is involved at all.
--
-- Keyed on the ABSOLUTE number rather than the village ordinal on purpose: a
-- village with no first moon yet has no ordinal, and its members still deserve
-- their moon grant. See `server/lib/characterPortraits.ts`.
--
-- NULL means this member's budget has never been read. First read sets it to
-- the current lunation and grants nothing extra, so a member who joined today
-- does not collect a moon grant for every lunation since the epoch.

CREATE TABLE IF NOT EXISTS `portrait_grants` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `user_id` varchar(64) NOT NULL,
  -- The three from profile setup. Banks forever, no ceiling.
  `setup_remaining` int NOT NULL DEFAULT 3,
  -- The moon half, 0 to 3.
  `moon_remaining` int NOT NULL DEFAULT 0,
  `moon_cycle` int NULL DEFAULT NULL,
  -- Every grant ever spent, including the ones spent on a picture the member
  -- then discarded. A discard spends, or the budget means nothing.
  `spent` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `user_id`)
) ENGINE=InnoDB;
