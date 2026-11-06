-- 0287: Gene Keys find a badge, a match, and a plainer Maia.
--
-- Two new columns on `member_gene_keys` (0272) and one badge row, so this file
-- is expand-only: the previous release neither reads nor writes either column,
-- and the badge row grants nothing while the badges module is off.
--
-- STILL NO BIRTH DATE, TIME OR PLACE. Nothing here holds one; 0272 says why.
--
-- `complement`: whether this member appears in "Who complements me", the view
-- that shows a member the people whose lines fill their gaps. OPT-IN ON BOTH
-- SIDES (Rye, 2026-10-23): a member sees only people who also said yes, and
-- only while both show their lines. Off until the member says yes.
--
-- `maia_plain`: "Talk to me plainly". With Maia allowed to use the lines
-- (`maia`), she still lets them shape what she suggests, but never adapts her
-- wording to the member's type or names it. Off by default.
--
-- THE BADGE, `lines-found`. Earned by finding your lines AND showing them,
-- counted by the earned-badge metric `gene_keys_shown` (server/lib/badges.ts),
-- so a member who keeps their lines hidden is never marked by a public badge
-- as having done Gene Keys. NO MULTIPLIER (Rye, 2026-10-30: "no multiplier on
-- the badge"): `multiplier` and `multipliers` stay NULL, and it never pays
-- Gratitude. INSERT IGNORE so a village that already made a badge with this id
-- keeps theirs, and so this file is safe to re-run.
ALTER TABLE `member_gene_keys`
  ADD COLUMN `complement` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `maia_plain` tinyint(1) NOT NULL DEFAULT 0;

INSERT IGNORE INTO `badges` (`id`, `name`, `description`, `icon`, `kind`, `capabilities`, `denies`, `rule`, `active`)
VALUES (
  'lines-found',
  'Lines found',
  'Found their Gene Keys lines and shows them to the village, so circles can see how they work best.',
  'sparkles',
  'earned',
  '[]',
  NULL,
  '{"metric":"gene_keys_shown","threshold":1}',
  1
);
