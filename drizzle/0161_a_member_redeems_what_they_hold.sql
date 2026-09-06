-- 0161: a member turns tokens into something real, and the tokens are destroyed.
--
-- THE FOUNDER'S SHAPE, in his words: "On platform all we need is a redemption
-- process that destroys currency that is redeemed. Then the off platform
-- redemption is governed by admins/stewards or a vote." And: "a member makes a
-- proposal to redeem X tokens for Y (services, cash, equity, etc something out
-- of the platform); when this redemption is confirmed by a steward or a vote
-- then at confirmation they are destroyed, but this confirmation is only meant
-- to happen after the redemption has occurred off platform."
--
-- So the village pays first and the platform destroys second. That ordering is
-- the requirement and it is kept. What it leaves open is the days in between,
-- and this table is mostly about those days.
--
-- ── WHY PROPOSING HOLDS ────────────────────────────────────────────────────
--
-- Wren proposes to redeem 500 credits for a bicycle. A steward hands Wren the
-- bicycle on Tuesday. On Wednesday, before the steward opens the panel, Wren
-- sends 500 credits to Ash. On Thursday the steward confirms, and the burn has
-- exactly two possible endings in this ledger, both wrong:
--
--   the post is REFUSED, because `postTransferOn` recomputes the balance inside
--   the transaction and finds zero. The village has bought a bicycle and
--   destroyed nothing.
--
--   or somebody hands the burn an allow-negative proof, which needs a fourth
--   entry in `ALLOW_NEGATIVE_SOURCES` and raises that member's lawful debt
--   floor by the redeemed amount forever. A negative balance also blocks exit
--   resolve, so Wren could never leave the village.
--
-- The fix is the shape this codebase already uses three times out of three for
-- value held while a decision is pending: an ESCROW ACCOUNT. Event seats go to
-- `sys:event-escrow`, library deposits to `sys:library-escrow`, voice claims to
-- `sys:voice-bridge`, and each keeps a row for the claim's state beside it.
-- Proposing posts the tokens to `sys:redemption-hold`; confirming posts them on
-- to `sys:redeemed`; every other ending REVERSES the hold.
--
-- A reservation column on `token_balances` was the alternative and it is not
-- available: that table is a CACHE recomputed from `token_ledger` inside every
-- posting's transaction, so a reservation written there is erased by the next
-- recompute. A reservation row read by each spender was the other alternative,
-- and there are FOURTEEN paths that debit a member. Only one of them passes a
-- ledger guard. The escrow binds all fourteen with no edit to any of them,
-- because the tokens are not in the member's account to be found.
--
-- Nothing is destroyed before the village has paid, which is his requirement.
-- Nothing can be spent twice, which is the gap.
--
-- ── WHY TWO ACCOUNTS AND WHY NEITHER IS A FAUCET ───────────────────────────
--
-- A faucet's NEGATIVE balance is that token's issued supply, so posting a burn
-- into the token's own faucet would reduce it. `spendSinkFor` in
-- server/lib/spending.ts already refuses that in writing, for `credits`:
-- burning them into the cycle-pool faucet "would quietly redefine that faucet's
-- negative balance from released-to-date into outstanding, which several
-- surfaces read". Three surfaces compute supply and two of them are balance
-- based while `mintView` is row based, so a faucet burn moves two of the three
-- numbers and leaves the third where it was.
--
-- `sys:redeemed` is therefore a SINK, not a faucet, exactly like `sys:voice-decay`
-- (0165). It only ever receives: its balance is positive and rising, and that
-- number is everything this village has retired. Issued supply does not fall.
-- The admin token panel prints the two side by side.
--
-- `sys:redemption-hold` is not a faucet for 0072's stated reason, which
-- transfers exactly: tokens held against an open redemption have to have come
-- from somebody, and a faucet there would let a redemption create the tokens it
-- redeems.
--
-- ── WHY A ROW ──────────────────────────────────────────────────────────────
--
-- 0106's sentence, and it is the same sentence here: "an approval that does not
-- pin the amount is an approval of nothing". The row holds the token, the
-- amount, what the member asked for in return, and WHICH WAY the village had
-- its dials turned at the moment of asking, all as they were when the
-- redemption was opened. The confirmation reads every one of them from here and
-- never from the confirmer's request body.
--
-- Not a `mechanics_proposals` row, for two reasons measured in the code:
-- `GET /api/game/mechanics/proposals` performs no auth check at all and says so
-- in its own docblock, so a redemption routed through it would be world
-- readable forever, including after a refusal; and every mechanics proposal
-- spends one of the member's five `governance.proposals_per_member_per_cycle`
-- rule changes for the moon, which inverts what that cap is for.
--
-- ── COLUMN NOTES ───────────────────────────────────────────────────────────
--
-- `amount` is `bigint` MINOR units, matching `token_ledger`.`amount` and
-- `admin_mint_requests`.`amount`. This is a deliberate departure from
-- `voice_claims`, which stores human `decimal(18,4)` and pays for it with two
-- "ALREADY CONVERTED, DO NOT CONVERT AGAIN" block comments on opposite sides of
-- one module. Every token is at 0 decimals today, so the choice is invisible
-- here and matters to the first fork that changes one.
--
-- `held_account` and `hold_key` are NULL when the village has turned the hold
-- off. The burn reads its FROM account off the row and never off the live dial,
-- so a dial moved while a redemption is open still settles the way it was
-- opened. That is `ballots`' snapshot law (0089 freezes thresholds, electorate
-- and weights at open) applied to one more thing.
--
-- `burn_key` is derived at INSERT and stored, so the burn cannot invent a key.
-- `token_ledger`.`idempotency_key` is UNIQUE, so a second confirmation that
-- somehow raced past the state claim writes no second ledger row.
--
-- Both key columns are UNIQUE. `hold_key` is nullable, and MySQL UNIQUE indexes
-- exempt NULLs, so a village with the hold turned off can hold any number of
-- rows carrying NULL there. That is the wanted behaviour and it is stated
-- because the usual reading of that trap is the opposite: a DEDUPE column must
-- be NOT NULL, and this one is not a dedupe column, it is a pointer to a ledger
-- row that may not exist.
--
-- `confirmed_by_mode` is the `redemption.confirmed_by` dial as it stood when the
-- member asked. A village that moves the dial mid-flight does not change how an
-- open redemption is decided.
--
-- No CHARSET clause, deliberately, and this is 0106's and 0078's reason:
-- `user_id`, `decided_by` and `token_slug` all join columns that inherit the
-- server default, and a table that pins its own collation cannot be joined
-- across the era split. No foreign keys, house norm.
--
-- `--` comments sit on their own lines and never end in `;`, the 0015 trap: the
-- runner splits statements on line-final semicolons.

-- The two accounts. System accounts must EXIST before anything posts to them:
-- `postTransfer` materialises `mem:` accounts on first touch and refuses an
-- unknown `sys:` id outright, because a typo'd system account is a bug to hear
-- about rather than an account to invent.
INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES
  ('sys:redemption-hold', 'system', NULL, 'Held against an open redemption', 0),
  ('sys:redeemed', 'system', NULL, 'Redeemed and retired', 0);

CREATE TABLE IF NOT EXISTS `redemptions` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `user_id` varchar(64) NOT NULL,
  `token_slug` varchar(64) NOT NULL,
  `amount` bigint NOT NULL,
  -- What the member would like these turned into, in their own words. A
  -- redemption with nothing asked for is a burn, and a burn is not what this is
  -- for, so the route refuses an empty one.
  `asked_for` varchar(500) NOT NULL,
  `state` enum('requested','confirmed','refused','withdrawn','expired') NOT NULL DEFAULT 'requested',
  `confirmed_by_mode` varchar(16) NOT NULL DEFAULT 'steward',
  `held_account` varchar(64) NULL,
  `hold_key` varchar(160) NULL,
  `burn_key` varchar(160) NOT NULL,
  `decided_by` varchar(64) NULL,
  `decided_at` timestamp NULL,
  -- Mandatory at the route for a confirm and for a refusal, following
  -- `closeBallot`, where the outcome note is required because a decision with
  -- no stated reason is not a record. Nullable here because a member's own
  -- withdrawal carries none and an expiry carries the reaper's own words.
  `decision_note` varchar(500) NULL,
  `expires_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `redemptions_hold` (`hold_key`),
  UNIQUE KEY `redemptions_burn` (`burn_key`),
  -- The two reads: "what does this member have open" and "what is the queue
  -- waiting on a steward, oldest first".
  KEY `redemptions_open_idx` (`village_id`, `user_id`, `state`),
  KEY `redemptions_queue_idx` (`village_id`, `state`, `created_at`)
) ENGINE=InnoDB;
