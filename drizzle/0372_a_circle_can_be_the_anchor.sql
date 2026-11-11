-- 0372: an admin can mark which circle is the anchor of the village.
-- Expand only: a new column, NOT NULL with a DEFAULT of 0, so every existing
-- circle reads as not marked. Pickers fall back to the circle that
-- coordinates the others when none is marked (shared/circlePicker.ts).
ALTER TABLE `circles` ADD COLUMN `is_anchor` tinyint(1) NOT NULL DEFAULT 0;
