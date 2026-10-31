-- 0285: work says the cash it pays, and the village keeps a record of the cash it owes.
--
-- WHAT THIS IS FOR.
-- Rye, 2026-10-23: "roles and quests and more can be paid in cash, tokens
-- (equity, credits, etc), and voice (governance) and most roles will carry all
-- 3, few quests will pay cash, but some will. So these all need to be available
-- for all contribution types." And minutes later: "The Game wouldn't pay cash,
-- but it would say what they are owed and they can claim it when they're paid
-- out so that the treasurer has a record to check when sending or giving cash
-- payments."
--
-- So the platform never moves money. Fiat flows in only, and this file changes
-- nothing about that: no ledger account, no token, no posting. A quest or a
-- role states the cash it pays, beside the tokens it pays (0265), and the
-- moment the work is paid in tokens the village also writes down the cash it
-- now owes that member. The member claims it when the village pays out, and
-- whoever holds `cash.pay` marks it paid once the money has actually changed
-- hands. An accepted proposal states its cash at the moment it is accepted.
--
-- THE FOUR COLUMNS ON THE WORK.
-- `cash_minor` is the cash the work pays, in minor units of `cash_currency`,
-- the same shape as `value_minor` (0265). On a quest it is owed once, at
-- consent. On a role it is owed to each seat every cycle, when the cycle
-- settles. NULL means the work pays no cash. `cash_currency` is the village's
-- currency at the moment the cash was set, kept on the row for the reason 0265
-- gives: a village that later changes currency must not silently rescale
-- every amount it ever wrote.
--
-- THE RECORD, `cash_owed`.
-- One row per member per occurrence of paid work. `occurrence_key` is the same
-- idea as a ledger idempotency key: the consent's claim, the role's seat and
-- cycle, the accepted submission. A retry of any of them writes nothing new.
-- The amount and the currency are copied from the work at that moment, and so
-- is its title, so the treasurer reads what was owed even after the quest is
-- renamed or the role is retired.
--
-- `state` moves one way: owed, then claimed by the member, then paid by a
-- holder of `cash.pay`. A holder may also mark an owed row paid directly, when
-- the money went out before anybody pressed claim. `paid_note` says how it was
-- paid, in the treasurer's words, and the route requires it, because a payment
-- with no stated method is not a record anybody can check.
--
-- AN ERASURE LEAVES THESE ROWS, deliberately. They are the village's record of
-- money it owed and paid, and the row holds an account id and an amount, never
-- a name: every reader joins the name, so an erased member reads as the
-- tombstone everywhere else does.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Four nullable columns with no default, and one new table. The previous
-- release names none of them, so it keeps reading and writing both tables
-- unchanged if it is put back over a migrated database. The UNIQUE key is on
-- the new table only.

ALTER TABLE `quests`
  ADD COLUMN `cash_minor` bigint NULL,
  ADD COLUMN `cash_currency` char(3) NULL;

ALTER TABLE `org_roles`
  ADD COLUMN `cash_minor` bigint NULL,
  ADD COLUMN `cash_currency` char(3) NULL;

CREATE TABLE IF NOT EXISTS `cash_owed` (
  `id` varchar(64) NOT NULL,
  `occurrence_key` varchar(191) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `work_kind` enum('quest','role','proposal') NOT NULL,
  `work_ref` varchar(64) NOT NULL,
  `work_title` varchar(255) NOT NULL,
  `amount_minor` bigint NOT NULL,
  `currency` char(3) NOT NULL,
  `state` enum('owed','claimed','paid') NOT NULL DEFAULT 'owed',
  `owed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `claimed_at` timestamp NULL,
  `paid_at` timestamp NULL,
  `paid_by` varchar(64) NULL,
  `paid_note` varchar(500) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cash_owed_occurrence` (`occurrence_key`),
  KEY `cash_owed_member` (`user_id`, `state`),
  KEY `cash_owed_queue` (`state`, `owed_at`)
);
