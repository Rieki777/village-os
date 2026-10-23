-- 0274: a role card carries the CCOS Role Card's own sections.
--
-- WHAT THIS IS FOR.
-- Rye, 2026-10-22: the player role card gains the sections of the CCOS Role
-- Card Template that Amora writes in its own plain words. Like the handover
-- words of 0268, they live on the ROLE and change only by consent, through an
-- org-chart draft (`update_seat` or `create_seat`), so they outlive whoever
-- holds the role. The card (shared/playerCard.ts) draws nothing for a role
-- that has none of them written.
--
-- THE SEVEN COLUMNS.
-- `exists_while`: "This role exists while ...", the condition the role
-- serves. One line, at most 300 characters (shared/roleCcos.ts).
-- `authorities`: a JSON list of short strings, "What I can decide on my own".
-- At most 8 items of 200 characters. Separate from `domain`, which the card
-- labels "What I look after".
-- `responsibilities`: a JSON list of the same shape, "What I do regularly".
-- `signs_stretched`, `flows_back`, `step_back`: the "Holding this role well"
-- box, CCOS ARC (Awareness, Reciprocity, Choice). At most 300 characters each.
-- `time_commitment`: a short chip, "Part of a full-time season". At most 80.
-- NULL means nobody has written it yet, which is the honest answer for every
-- role that existed before this file.
--
-- WHO WRITES THEM.
-- Only an org draft, on publish (server/lib/orgDrafts.ts `applyChange`),
-- after the one parser (shared/roleCcosParse.ts) has checked them at preview
-- and again at publish. Revert puts them back from `before_json`, and only
-- when that change's `before_json` captured them, so reverting a draft
-- published before this file never wipes words written since.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Seven nullable columns with no default on a table every writer reaches
-- with raw SQL naming its own columns. The previous release names none of
-- them, so it keeps reading and writing `org_roles` unchanged if it is put
-- back over a migrated database.

ALTER TABLE `org_roles`
  ADD COLUMN `exists_while` text NULL,
  ADD COLUMN `authorities` json NULL,
  ADD COLUMN `responsibilities` json NULL,
  ADD COLUMN `signs_stretched` text NULL,
  ADD COLUMN `flows_back` text NULL,
  ADD COLUMN `step_back` text NULL,
  ADD COLUMN `time_commitment` varchar(80) NULL;
