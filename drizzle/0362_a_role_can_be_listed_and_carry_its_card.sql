-- 0362: a role can be listed, and carries the parameters of its full card.
--
-- WHAT THIS IS FOR.
-- Role journey (Rye, 9 Nov 2026): only roles a steward has confirmed are
-- discoverable. `listed` is that switch. NULL reads as listed, so no village
-- changes on deploy; only an explicit 0 hides a role from the lists a visitor
-- or member browses (shared/roleListing.ts). Holders keep an unlisted role.
--
-- The other columns are the parameters the full card shows beside the role
-- (shared/roleParams.ts), added in the same file so the later pull requests
-- need no migration of their own:
--   village_goals      json, the season goals the role serves
--   track              varchar(24), paid, volunteer, local or ai
--   selection_criteria json, 3 to 5 short lines
--   conversations      json, the ordered conversations: role id, minutes, final approval
--   conversation_mode  varchar(16), block (one block, the default when NULL) or separate
--   where_worked       varchar(24), land, remote or both
--   languages          json, the languages the work runs in
--   budget_line        varchar(120), the budget line name (members)
--   funded_from        date, when the funding starts
--   review_after_days  int, days from seating to the first review
--   access_bundle      json, what a holder is given access to (steward view)
--   booking_url        varchar(300), where a first conversation is booked
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Thirteen nullable columns with no default on a table every writer reaches
-- with raw SQL naming its own columns. The previous release names none of
-- them, so it keeps reading and writing `org_roles` unchanged if it is put
-- back over a migrated database.

ALTER TABLE `org_roles`
  ADD COLUMN `listed` tinyint(1) NULL,
  ADD COLUMN `village_goals` json NULL,
  ADD COLUMN `track` varchar(24) NULL,
  ADD COLUMN `selection_criteria` json NULL,
  ADD COLUMN `conversations` json NULL,
  ADD COLUMN `conversation_mode` varchar(16) NULL,
  ADD COLUMN `where_worked` varchar(24) NULL,
  ADD COLUMN `languages` json NULL,
  ADD COLUMN `budget_line` varchar(120) NULL,
  ADD COLUMN `funded_from` date NULL,
  ADD COLUMN `review_after_days` int NULL,
  ADD COLUMN `access_bundle` json NULL,
  ADD COLUMN `booking_url` varchar(300) NULL;
