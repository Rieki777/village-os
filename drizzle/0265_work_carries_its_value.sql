-- 0265: a quest and a role say what they are worth, and what they pay.
--
-- WHAT THIS IS FOR.
-- Rye, 2026-10-21: every quest carries a value from the moment it is created,
-- and quest and role cards show every token assigned to them, or "inquire for
-- payment details" when no value is set. The value is held in the village's
-- own currency, and the token amounts sit beside it. Gratitude is not one of
-- them: its only job is sharing out the cycle pool.
--
-- THE THREE COLUMNS, ON BOTH TABLES.
-- `value_minor` is the worth in minor units of `value_currency`, the same
-- shape a seat's terms use for pay (shared/seatSettings.ts). NULL means no
-- value has been set, which is the honest answer for every quest and role
-- that existed before this file, and the card then says to inquire.
-- `value_currency` is the village's currency at the moment the value was set,
-- kept on the row so a village that later changes its currency does not
-- silently rescale every value it ever wrote.
-- `value_tokens` is the JSON list of what the platform pays for the work:
-- [{"token":"credits","amount":40}], human amounts. On a quest it is paid once,
-- at consent. On a role it is paid to each seat every cycle. NULL means the
-- work has no list of its own and the village's standard mint rules pay it, as
-- they did before this file. An empty list means the work pays no tokens.
-- Each amount is still clamped by the ceiling on the village's mint rule for
-- that token (server/lib/workPay.ts), so a typed figure can never mint past
-- what the village voted.
--
-- WHO WRITES THEM.
-- The quest save path (server/repos/quests.ts) and the role save path name
-- their own columns in raw SQL; nothing reaches either table through
-- `dbCollection`, so no writer resets an omitted column.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Six nullable columns with no default. The previous release names none of
-- them, so it keeps reading and writing both tables unchanged if it is put
-- back over a migrated database, and every quest pays through the standard
-- rules again, which is what it did before.

ALTER TABLE `quests`
  ADD COLUMN `value_minor` bigint NULL,
  ADD COLUMN `value_currency` char(3) NULL,
  ADD COLUMN `value_tokens` json NULL;

ALTER TABLE `org_roles`
  ADD COLUMN `value_minor` bigint NULL,
  ADD COLUMN `value_currency` char(3) NULL,
  ADD COLUMN `value_tokens` json NULL;
