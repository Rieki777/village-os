-- 0268: a role says what to bring it, what it does not hold, and how its work is done.
--
-- WHAT THIS IS FOR.
-- Rye, 2026-10-22: "Bring me", "Not mine to hold" and the runbook live on the
-- ROLE. They change by consent through an org-chart draft, the same way aim
-- and domain do, so they outlive whoever holds the role and count toward its
-- handover. The player card (shared/playerCard.ts) already reads them as
-- optional role fields and draws nothing until they exist.
--
-- THE THREE COLUMNS.
-- `bring_me` is a JSON list of short strings: what people should bring to
-- this role. At most 8 items of 160 characters each (shared/roleHandover.ts).
-- `not_mine` is a JSON list of the same shape: what this role does not hold,
-- so people take it elsewhere.
-- `runbook` is how the work is done: a few words, or one https link to where
-- it is written down. At most 2000 characters.
-- NULL means nobody has written it yet, which is the honest answer for every
-- role that existed before this file, and the card says "not written".
--
-- WHO WRITES THEM.
-- Only an org draft, on publish (server/lib/orgDrafts.ts `applyChange`,
-- `update_seat` and `create_seat`), after the one parser has checked them.
-- Revert puts them back from `before_json`, and only when that change's
-- `before_json` captured them, so reverting a draft published before this
-- file never wipes words written since.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Three nullable columns with no default on a table every writer reaches with
-- raw SQL naming its own columns. The previous release names none of the
-- three, so it keeps reading and writing `org_roles` unchanged if it is put
-- back over a migrated database.

ALTER TABLE `org_roles`
  ADD COLUMN `bring_me` json NULL,
  ADD COLUMN `not_mine` json NULL,
  ADD COLUMN `runbook` text NULL;
