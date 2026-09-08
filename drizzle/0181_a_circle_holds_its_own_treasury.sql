-- 0181: a circle budget says WHICH MODEL it runs on, and a change to that
-- model is queued for a period boundary instead of applied.
--
-- 0084 gave a circle a declared envelope. 0188 gave that envelope a second
-- cap. Both are the same model: a right to ISSUE, bounded, measured off the
-- ledger, holding nothing. Rye ruled that a village may instead mint a circle
-- a TREASURY up front, per circle, so both models run in one village at once:
--
--   "The mode is chosen per circle (the village can set treasuries or spending
--   caps on a circle-by-circle basis) as a general rule we want to give a lot
--   of freedom to circles to govern in unique ways that are specific to the
--   type of work they're doing."
--
-- And why they must behave differently:
--
--   "This way they behave different minting a whole treasury up front where
--   they can underspend and save it, gives an incentive to save. While a
--   spending cap creates an incentive to spend the whole cap."
--
-- WHERE THE TOKENS LIVE, WHICH IS NOT HERE. A treasury is real tokens in a
-- real ledger account, `sys:circle:<circleId>`, and every movement in or out
-- goes through the posting functions in server/lib/ledger.ts. This table gains
-- no balance column, and nothing in this file or anywhere near it holds one:
-- `token_balances` is the only cache of a balance in this system and it is
-- recomputed, never incremented. A budget row still declares; the ledger still
-- holds.
--
-- ── mode: NOT NULL WITH A DEFAULT, WHICH IS SAFE HERE AND USUALLY IS NOT ────
--
-- The house rule warns that a NOT NULL column with a DEFAULT is still unsafe
-- when the previous release writes an EXPLICIT NULL into it, because
-- server/repos/store-db.ts names every spec'd column on every INSERT. That
-- rule does not reach this table: `circle_budgets` has no store spec and no
-- repo. Its only writer is `upsertBudget` in server/lib/resources.ts, which is
-- hand-written SQL naming its columns one by one, and the previous release's
-- copy of that function cannot name a column it has never heard of. So the
-- DEFAULT applies, and a rollback over an already-migrated database keeps
-- reading and writing this table exactly as it did.
--
-- Verified rather than assumed: grep for `circle_budgets` across server/ finds
-- the three statements in resources.ts, one DELETE, and the example seeder,
-- and nothing else writes it.
--
-- DEFAULT 'cap' AND NOT 'treasury'. Every row that exists today was written
-- under the cap model and is metered under it right now. A default of
-- 'treasury' would silently move every circle in every village onto a model
-- with an empty account, which reads as a circle that has spent everything.
--
-- ── THE PENDING COLUMNS, AND WHY THE DEFERRAL IS AN INSTANT ────────────────
--
-- Rye: "As a default rule we don't switch between treasury or cap modes
-- between cycles, these changes take place at the start of a new cycle (in
-- this case the default would be each season) So this way we don't have this
-- issue and they just finish out the season with the current model and
-- upgrade/change for the next season how to run."
--
-- So a mode change is SCHEDULED. This is the same shape 0075 gave mint_rules,
-- and server/lib/economy.ts holds the pattern: `queueRuleChange` writes the
-- pending columns, `applyPendingRules` promotes them in one statement, and the
-- live values are untouched until then.
--
-- ONE DIFFERENCE, AND IT IS FORCED BY THE PERIOD. 0075 defers to
-- `pending_from_cycle`, an INT, because the clock hands out cycle numbers. A
-- SEASON has no number: it is a dated civil span in the village's own zone
-- with a slug for an id. `pending_from` is therefore the INSTANT the next
-- period begins. An instant orders the same way an integer does, it is the
-- unit server/lib/circleBurn.ts already converts both boundaries into, and it
-- survives a founder re-editing the season calendar underneath a queued
-- change, which a stored season id would not.
--
-- `pending_from` alone says whether a change is queued, the way
-- `pending_from_cycle` does in 0075: promoting clears all four together, so
-- there is no window in which a row carries both a new mode and a stale
-- pending copy of it.
--
-- datetime rather than timestamp for `pending_at`, because `timestamp NULL`
-- behaves differently under explicit_defaults_for_timestamp and a queued
-- change that silently acquired CURRENT_TIMESTAMP would read as landing now.
--
-- Every column here is an ADD and the index is non-unique, so this file is
-- expand-only in the sense docs/CLAUDE.md means it.

-- ── WHAT A DORMANT CIRCLE LEAVES BEHIND, AND WHY IT IS RECORDED ────────────
--
-- Rye ruled the dormancy case: "If a circle goes dormant the treasury is
-- destroyed or sent back to a master treasury (if there is one). To be
-- reissued if that circle comes alive again."
--
-- So a dormant circle holds NOTHING. The sweep runs the moment the status
-- changes and the tokens go to `sys:treasury` where a village has one, and to
-- `sys:redeemed` where it does not, which is the same door redemption burns
-- through so that destroyed means destroyed and the retired figure accounts
-- for it.
--
-- These three columns are the RECORD of that, and they exist because
-- "reissued if that circle comes alive again" is a different act from "funded
-- afresh". A steward reviving a circle expects to give it back what it had,
-- and after the sweep the ledger shows an account at zero with no memory of
-- what left it. Without these columns the amount would have to be reconstructed
-- from history by whoever happened to ask.
--
-- THREE STATES THAT MUST NOT BE CONFLATED, and this is what tells them apart:
-- a circle that never had a treasury (`dormant_at` NULL and nothing funded), a
-- circle whose treasury was swept when it went dormant (`dormant_at` set), and
-- a circle awake with a treasury of zero because it spent everything
-- (`dormant_at` NULL with funding in the ledger). All three read zero, and all
-- three mean something different.

ALTER TABLE `circle_budgets`
  -- AFTER `amount_minor`, NOT after `cycle_amount_minor`, and the difference is the whole
  -- reason this file boots. `cycle_amount_minor` is added by
  -- `0188_a_circle_has_two_caps.sql`, which was `0168` when this file was written and sorted
  -- BEFORE it. The renumber lane had to move that file above `0181` (numbers only go
  -- forward, and `0181` had already taken its place in the base), so it now sorts AFTER this
  -- one and the column does not exist yet when this statement runs. Naming it here failed
  -- loud with `Unknown column 'cycle_amount_minor' in 'circle_budgets'`, which on this
  -- platform is not a failed deploy, it is a village that cannot start.
  --
  -- The final column layout is UNCHANGED, which is what makes this edit equivalent and not
  -- merely tolerable: `0188` adds `cycle_amount_minor` AFTER `amount_minor` too, and it runs
  -- second, so the table ends up `amount_minor`, `cycle_amount_minor`, `mode`, exactly as it
  -- read when the two files ran the other way round. `AFTER` decides ordinal position and
  -- nothing else, and nothing in this codebase reads an ordinal position.
  ADD COLUMN `mode` enum('cap','treasury') NOT NULL DEFAULT 'cap' AFTER `amount_minor`,
  ADD COLUMN `pending_mode` enum('cap','treasury') NULL AFTER `mode`,
  ADD COLUMN `pending_from` datetime NULL AFTER `pending_mode`,
  ADD COLUMN `pending_by` varchar(64) NULL AFTER `pending_from`,
  ADD COLUMN `pending_at` datetime NULL AFTER `pending_by`,
  ADD COLUMN `dormant_held_minor` bigint NULL AFTER `pending_at`,
  ADD COLUMN `dormant_at` datetime NULL AFTER `dormant_held_minor`,
  ADD COLUMN `dormant_to` varchar(32) NULL AFTER `dormant_at`;

-- The sweep that promotes queued changes reads exactly this.
ALTER TABLE `circle_budgets`
  ADD KEY `circle_budgets_pending_idx` (`pending_from`);
