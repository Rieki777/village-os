-- 0213: a redemption remembers what it was worth on the day it was asked for.
--
-- Ruling 23 (2026-09-15). A village now says what a token is worth, what it
-- keeps as a fee, and how much it will pay in a moon. Every one of those is a
-- dial, and a dial moves.
--
-- THE SNAPSHOT LAW, which this table already follows once. `held_account` is
-- written at request time and the burn reads its FROM account off the column
-- rather than off the live dial, so a village that turns the hold off while a
-- request is open still settles the way it was opened (0201). The same reason
-- applies to money, and harder: a member agreed to a number, and a steward
-- confirms against the number the member agreed to. Reading the dials at
-- confirmation would mean a founder editing a rate could change what an open
-- request is worth, after the fact, with nobody told.
--
-- So each of these is written once, at the ask, and never updated.
--
--   currency         what this request is counted in (ISO 4217, three letters)
--   rate_minor       minor units of `currency` for ONE whole token
--   rate_source      'exchange' (the posted price) or 'set' (the village's own)
--   fee_pct          the share the village keeps, as a percentage
--   fee_fixed_minor  the flat fee, in minor units of `currency`
--   gross_minor      what the tokens came to
--   fee_minor        what the village keeps
--   net_minor        what the member receives
--   process_text     the village's own instructions, as they read that day
--
-- EVERY ONE IS NULLABLE, and that is the honest shape rather than a default of
-- zero. A row written before this release has no currency and no rate, and zero
-- would say this village valued it at nothing. NULL says nobody put a number on
-- it, which is what actually happened, and it is also the live state for a
-- village that redeems for services and posts no prices at all.
--
-- NOTHING HERE IS A LEDGER FIGURE. The tokens destroyed at confirmation are the
-- tokens asked for, in full: the fee comes out of the payment the village makes
-- off the platform, which this software never sees. These columns are what the
-- two people agreed to read, and no posting is derived from any of them.
--
-- EXPAND, NEVER CONTRACT: nine nullable columns added to a populated table. The
-- previous release names none of them in any SELECT or INSERT, so it keeps
-- working exactly as it did, and nothing it writes can violate a constraint
-- that does not exist.
--
-- No new index. The two cap reads are village-and-cycle and member-and-cycle,
-- which `redemptions_queue_idx` (village_id, state, created_at) and
-- `redemptions_open_idx` (village_id, user_id, state) already serve.

ALTER TABLE `redemptions`
  ADD COLUMN `currency` varchar(3) NULL,
  ADD COLUMN `rate_minor` bigint NULL,
  ADD COLUMN `rate_source` varchar(16) NULL,
  ADD COLUMN `fee_pct` decimal(6,3) NULL,
  ADD COLUMN `fee_fixed_minor` bigint NULL,
  ADD COLUMN `gross_minor` bigint NULL,
  ADD COLUMN `fee_minor` bigint NULL,
  ADD COLUMN `net_minor` bigint NULL,
  ADD COLUMN `process_text` text NULL;
