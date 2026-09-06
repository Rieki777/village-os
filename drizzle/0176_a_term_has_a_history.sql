-- EVERY TERM A SEAT HAS EVER HELD, APPEND-ONLY.
--
-- `role_holders` carries UNIQUE (role_id, user_id) from 0002. That key is the
-- right one for the question the table answers, "does this person hold this
-- role right now", and it makes a second row impossible. So the CURRENT term
-- lives there and the history cannot: seat somebody, let the term run out,
-- seat them again next season, and the second seating overwrites the first
-- with no trace that the first ever happened.
--
-- The audit of 2026-09-03 named the consequence. The term is the only backstop
-- on a seat that can veto, and a backstop nobody can audit is not a backstop.
-- A village has to be able to read "Wren held this from the March moon to the
-- June moon, and it ended because the term reached its date" a year later,
-- and it has to be able to tell that apart from "Wren was taken out".
--
-- ── APPEND ONLY, AND WHAT EACH COLUMN MEANS ────────────────────────────────
--
--   term_started_at  when the holding began. Written once, never moved.
--   term_ends_at     the instant the term is due to end. Computed from the
--                    cycle clock (see `termEndsAtFromCycles` in
--                    server/lib/stewardship.ts), never read off the season
--                    list, because seasons are an ungoverned admin list whose
--                    entries can be open-ended and whose dates run out.
--                    NULL only for a holding written before this table.
--   ended_at         when the holding actually stopped. NULL while it runs.
--                    A term that lapsed on its date has `ended_at` equal to
--                    `term_ends_at`; a term that was ended early by a
--                    `role_unseat` ballot has an earlier one, and the two
--                    stay different facts.
--   ended_by         the ballot id or the user id that ended it, or NULL when
--                    the date ended it and nobody did.
--   season_id        the season running when the holding began, kept because
--                    it is the fact `role_holders.season_id` records and a
--                    second shape would be a second rule.
--
-- Nothing here is read by the capability gate. `roleCapabilitiesFor` reads
-- `role_holders` and `holdingHasLapsed`, and it stays that way: this table is
-- the record, not the authority, and a permission plane with two sources of
-- truth is the defect this whole build exists to remove.
--
-- EXPAND ONLY. One CREATE TABLE, no backfill, nothing altered.
CREATE TABLE IF NOT EXISTS `role_holder_terms` (
  `id` varchar(64) NOT NULL,
  `role_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `term_started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `term_ends_at` timestamp NULL,
  `season_id` varchar(64) NULL,
  `ended_at` timestamp NULL,
  `ended_by` varchar(64) NULL,
  PRIMARY KEY (`id`),
  KEY `role_holder_terms_seat_idx` (`role_id`, `user_id`, `term_started_at`),
  KEY `role_holder_terms_user_idx` (`user_id`),
  KEY `role_holder_terms_open_idx` (`ended_at`)
);
