-- 0222: a village reads itself against the governance canvas, one block at a
-- time, and every reading is kept.
--
-- Rye, 2026-09-24: every canvas block must be on record before a village's
-- Birthing, and a canvas-style 1 to 5 radar is allowed for the canvas
-- baseline only, as an explicit exception to the no-scorecard rule R55.
-- Season Two projects take their first reading of all twelve blocks on
-- Saturday 3 October. The blocks themselves live in code
-- (shared/governanceCanvas.ts); this table holds what a village says about
-- them.
--
-- ── APPEND-ONLY, AND THAT IS THE WHOLE DESIGN ──────────────────────────────
--
-- One row per reading. A block's current level is its NEWEST row, and every
-- older row stays as the history a village reads its own movement from. No
-- route updates or deletes a row, and server/repos/canvasReadings.ts exposes
-- no statement that could. A reading that turns out wrong is answered by a
-- newer reading with a sentence saying why, which is how the record stays
-- honest about when the village changed its mind.
--
-- `id` is AUTO_INCREMENT so "newest" has an answer even when two readings of
-- one block land in the same second: ordering is `created_at` then `id`.
--
-- ── THE COLUMNS ────────────────────────────────────────────────────────────
--
-- `block_id` is validated against the registry by the route, and is a
-- varchar so a block added to the canvas later needs no migration.
-- `level` is held to 1 to 5 by the route AND by the CHECK below, so a row
-- written by hand cannot put a 0 or a 6 on the radar.
-- `recorded_by` is the member who wrote the reading, at the width of
-- `users.id`. `moment` names the occasion; the first reading of every block
-- is the baseline, so that is the default.
--
-- ── EXPAND-ONLY, AND THE ROLLBACK IS A NO-OP ───────────────────────────────
--
-- One new table, `CREATE TABLE IF NOT EXISTS`, one non-unique index inside
-- it, no `ALTER`, no foreign key. The previous release neither reads nor
-- writes it, so putting the old image back leaves the rows sitting there and
-- a re-deploy picks them up again. Replaying the file is a no-op because
-- `IF NOT EXISTS` is the whole statement. `ENGINE=InnoDB` with no CHARSET
-- clause, so `recorded_by` joins `users.id` in the schema's own collation.

CREATE TABLE IF NOT EXISTS `canvas_readings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `block_id` varchar(32) NOT NULL,
  `level` tinyint NOT NULL,
  `sentence` text NOT NULL,
  `recorded_by` varchar(64) NOT NULL,
  `moment` varchar(32) NOT NULL DEFAULT 'baseline',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `canvas_readings_block_time` (`block_id`, `created_at`),
  CONSTRAINT `canvas_readings_level_one_to_five` CHECK (`level` BETWEEN 1 AND 5)
) ENGINE=InnoDB;
