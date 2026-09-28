-- 0224: a village keeps its own copy of the Governance Canvas Database, the
-- resources the canvas's authors list beside it, and shows them per block.
--
-- Plan 5.1-5.3, Wave 4 of the Governance Canvas build. The database is a
-- public spreadsheet kept by the Bioregional Weaving Labs Collective and
-- Commonland. server/lib/canvasResourcesSync.ts reads its five public columns
-- nightly (dial `canvas.resources_sync`, on by default), or loads the snapshot
-- shipped in server/seeds/canvas-resources.json when the table is empty. All
-- the SQL is server/repos/canvasResources.ts.
--
-- ── NO COLUMN FOR A PERSON ────────────────────────────────────────────────
--
-- The sheet also records who suggested each row: a name, an email address,
-- an organisation and a timestamp. This table has no column for any of them,
-- and the read never fetches them. Every stored field has email-shaped text
-- stripped before it is written (shared/canvasResources.ts, `stripEmails`).
--
-- ── THE COLUMNS ───────────────────────────────────────────────────────────
--
-- `resource_key` is the SHA-1 (40 hex characters) of the resource's
-- normalised name and normalised address together, so the same row read on
-- two nights is one row here. `name_slug` is the normalised name, which the
-- platform's block map (shared/canvasResourceTags.ts) is keyed by. `url` is
-- NULL and `link_pending` is 1 for a row whose address upstream is a filename
-- or nothing. `keywords` is a JSON list of words split out of the
-- description.
--
-- Block tags, three layers, each a JSON list of block ids:
--   `tags_suggested`  what the keywords suggest, each with the keyword that
--                     matched, as [{"block":"power","keyword":"consent"}]
--   `tags_confirmed`  the platform's hand-made map at the last write, a copy
--                     for anybody reading this table directly (the page reads
--                     the map itself, so a corrected map applies at once)
--   `tags_local`      this village's own placing, written only by the canvas
--                     pen; NULL means none. Never touched by a read of the
--                     database.
--
-- `source` is `database` (read from the sheet) or `snapshot` (the shipped
-- copy). `withdrawn_at` is set when a row is gone upstream and cleared if it
-- comes back; a row is never deleted. `link_status` is `unchecked`, `ok`,
-- `broken` or `refused`, written by the link check with `link_checked_at`.
-- Every set of words is a varchar, never an enum, so a later release can add
-- one with no ALTER (0019's header).
--
-- ── EXPAND-ONLY, AND THE ROLLBACK IS A NO-OP ───────────────────────────────
--
-- One new table, `CREATE TABLE IF NOT EXISTS`, one non-unique index, no
-- `ALTER`, no foreign key. The previous release neither reads nor writes it,
-- so putting the old image back leaves the rows where they are and a
-- re-deploy picks them up again. Replaying the file is a no-op. `ENGINE=InnoDB`
-- with no CHARSET clause, so `tags_local_by` joins `users.id` in the schema's
-- own collation.

CREATE TABLE IF NOT EXISTS `canvas_resources` (
  `resource_key` char(40) NOT NULL,
  `name_slug` varchar(200) NOT NULL,
  `name` varchar(500) NOT NULL,
  `type` varchar(64) NOT NULL DEFAULT '',
  `authors` varchar(500) NOT NULL DEFAULT '',
  `description` text NULL,
  `keywords` text NULL,
  `url` varchar(2048) NULL,
  `link_pending` tinyint(1) NOT NULL DEFAULT 0,
  `tags_suggested` text NULL,
  `tags_confirmed` text NULL,
  `tags_local` text NULL,
  `tags_local_by` varchar(64) NULL,
  `tags_local_at` datetime NULL,
  `source` varchar(16) NOT NULL DEFAULT 'database',
  `first_seen_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `withdrawn_at` datetime NULL,
  `link_status` varchar(16) NOT NULL DEFAULT 'unchecked',
  `link_checked_at` datetime NULL,
  PRIMARY KEY (`resource_key`),
  KEY `canvas_resources_withdrawn` (`withdrawn_at`)
) ENGINE=InnoDB;
