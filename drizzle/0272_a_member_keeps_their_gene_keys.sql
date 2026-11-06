-- 0272: a member keeps their Gene Keys lines and Human Design type.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves a table nobody asks about.
--
-- THE CONTRACT IS shared/geneKeys.ts. The chart is read from the sky in the
-- member's own browser (shared/geneKeysSky.ts), and only the result arrives
-- here. THERE IS NO BIRTH DATE, TIME OR PLACE IN THIS SCHEMA, and no column
-- may ever be added to hold one: "your birth details never leave this screen"
-- is the promise the birth form makes, and this table is where it is kept.
--
-- WHAT IS STORED, AND WHY NOTHING ELSE:
--   - `chart`: the 26 activations (13 bodies at birth, 13 at the design
--     moment), each a gate and a line. All eleven Gene Keys spheres and the
--     Human Design type are read from it, so a later release can show the
--     Venus and Pearl sequences without asking the member for anything again.
--     The server checks it against the sky's own rules before it is written
--     (`chartProblems`): Earth opposite the Sun, the nodes opposite, the design
--     Sun 88 degrees back.
--   - `profile`, `hd_type`, `hd_authority`: derived from `chart` by the SERVER
--     (`analyse`), never taken from the request, kept as columns so a circle's
--     view reads them without parsing JSON per member.
--   - `visibility`: 'show' by default (Rye, 2026-10-22: visible by default; a
--     member can skip Gene Keys entirely, or do them and hide them). 'hide'
--     means hidden everywhere: profile, circle view, role applications.
--   - `maia`: whether Maia may use these lines to guide this member. Off until
--     the member says yes.
--   - `source`: how the result was set. 'exact' from a birth time, 'chosen'
--     when the member picked between windows because the time was unknown or
--     close to a change, 'typed' when they entered a profile they already had.
--   - `calc_version`: GENE_KEYS_CALC_VERSION when it was computed, because no
--     birth data is kept to compute it again; a fixed bug asks the members it
--     touched to enter their details once more.
--
-- NO FOREIGN KEYS, the same as every table in this schema. `user_id` is
-- reconciled by the tombstone path: `anonymizeMember` (server/lib/erasure.ts)
-- deletes the member's row in its `gene-keys-after-tombstone` step.

CREATE TABLE IF NOT EXISTS `member_gene_keys` (
  `user_id` varchar(64) NOT NULL,
  -- JSON: { personality: { Sun: { gate, line }, ... }, design: { ... } }.
  `chart` text NOT NULL,
  -- '2/5'. One of the twelve that exist.
  `profile` varchar(3) NOT NULL,
  `hd_type` varchar(32) NOT NULL,
  `hd_authority` varchar(32) NOT NULL,
  `visibility` enum('show','hide') NOT NULL DEFAULT 'show',
  `maia` tinyint(1) NOT NULL DEFAULT 0,
  `source` enum('exact','chosen','typed') NOT NULL,
  `calc_version` smallint NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
);
