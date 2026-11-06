-- 0296: a live session pulls a card.
--
-- Rye, 2026-10-30: an optional "pull a card" at the start of a live session.
-- Anyone in the room may pull, as many times as they like; each pull is a
-- reading that weaves the Gene Keys and Human Design of the people present
-- with the sky of the day, and names each of them (shared/sessionCard.ts).
--
-- Two new tables and one new column, so this file is expand-only: the previous
-- release neither reads nor writes any of them.
--
-- STILL NO BIRTH DATE, TIME OR PLACE. A card holds the sky of the DAY it was
-- pulled, the same for everybody, and words derived from charts already saved
-- in `member_gene_keys` (0272, which says why no birth may be stored).
--
-- `session_cards`: one row per pull. `n` counts the session's cards from 1.
-- `sky` is the day's sky as the puller's browser read it, checked on the way in
-- (`parseSky`); `reading` is the collective part everybody in the room sees:
-- its paragraphs, the suggestions for holding the session, who was welcomed
-- by name, and whether Maia wove it or the plain builder did.
--
-- `session_card_lines`: one row per person PRESENT when the card was pulled.
-- `line` is that person's own words, private to them until they set `shared`;
-- it is NULL for somebody the card welcomed and did not read. The row exists
-- either way, so a member's erasure finds every card that names them.
--
-- A CARD LASTS AS LONG AS ITS SESSION. Once the session closes, its cards and
-- their lines are deleted (server/lib/sessionCard.ts `clearClosedCards`), the
-- way the arrival round's words are erased at close.
--
-- `member_gene_keys.card_out`: "Leave me out of session cards". A member who
-- sets it is welcomed by name and never read, whatever else they allow.
CREATE TABLE IF NOT EXISTS `session_cards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` int NOT NULL,
  `n` smallint NOT NULL,
  `pulled_by` varchar(64) NOT NULL,
  `sky` text NOT NULL,
  `reading` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_cards_session_n` (`session_id`, `n`)
);

CREATE TABLE IF NOT EXISTS `session_card_lines` (
  `card_id` int NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `line` text NULL,
  `shared` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`card_id`, `user_id`),
  KEY `session_card_lines_user` (`user_id`)
);

ALTER TABLE `member_gene_keys`
  ADD COLUMN `card_out` tinyint(1) NOT NULL DEFAULT 0;
