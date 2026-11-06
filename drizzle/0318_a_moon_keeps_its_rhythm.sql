-- Deep-dive items and the moon's reminders (spec section 17, A1 and B1).
--
-- moon_recap_items gains where a deep-dive item's proof lives (evidence_kind:
-- sera, artifact, mail, notes, drive, file or build), the day of that proof,
-- and, for Outside my roles work, the role it belongs to in the member's own
-- words. Another member never reads a mail, notes, drive or file link, even
-- on an item marked for members; that rule is in shared/moonRecap.ts.
--
-- moon_nudges records each end-of-moon reminder sent: one row per member,
-- cycle and kind (eom_prep, eom_day, halfway). The insert is the claim, so
-- two job ticks in one hour send one reminder. Every key column is NOT NULL.
-- Rows naming a member go in member erasure.
--
-- moon_recaps gains thanks_json (addendum v5, A7): who helped the member this
-- moon, up to ten entries of a member id or a name and a short note. Nothing
-- here sends gratitude; the member sends it through the gratitude flow.
--
-- Expand only: four nullable columns on tables 0313 made, and one new table.

ALTER TABLE `moon_recap_items`
  ADD COLUMN `evidence_kind` varchar(8) NULL,
  ADD COLUMN `evidence_on` date NULL,
  ADD COLUMN `belongs_to_seat_words` varchar(200) NULL;

ALTER TABLE `moon_recaps`
  ADD COLUMN `thanks_json` text NULL;

CREATE TABLE IF NOT EXISTS `moon_nudges` (
  `user_id` varchar(64) NOT NULL,
  `cycle_id` varchar(32) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `sent_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `cycle_id`, `kind`)
);
