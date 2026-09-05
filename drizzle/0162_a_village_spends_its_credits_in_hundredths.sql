-- 0162: two decimals on what a village spends, and Voice comes down to two.
--
-- Rye ruled the scale on 2026-09-04: two decimals on currency-like tokens,
-- whole numbers for everything else, and Village Voice at two rather than the
-- three it carried. `shared/tokenScale.ts` is the one home for both numbers and
-- carries the reasoning; this file moves the stored registry to match it.
--
-- WHICH TOKENS ARE CURRENCY-LIKE IS A COLUMN AND NOT A JUDGEMENT. A token that
-- is spent, priced or exchanged is currency-like, and in this build that set is
-- exactly `kind = 'credit'` with `governance = 'platform'`:
--
--   `isPriceableToken` (server/lib/spending.ts) narrows a price to credit kind.
--   `redeemableToken` (server/lib/redemption.ts) narrows a redemption to it.
--   `tradingProblem` (server/lib/exchange.ts) refuses recognition by name,
--   refuses every hypha-governed token, refuses voice kind, and then refuses
--   anything that is not credit kind.
--
-- So `credits`, `stay-credit` and `library-credit` move, and so does any credit
-- token a village created for itself, because the same three refusals treat it
-- the same way. Selecting BY KIND and never by a list of slugs is what makes
-- that true for a fork this file will never see.
--
-- WHAT DOES NOT MOVE, AND WHY EACH ONE STAYS WHOLE:
--
--   `gratitude` is recognition. It can never be a price, never be bought,
--   never be swapped and never be redeemed, and every one of those is refused
--   in code by name. A recognition token has no financial value of its own, so
--   a scale on it is a conversion surface bought for nothing.
--   `equity` is equity and `voice` is voice, both `governance = 'hypha'`:
--   read-only mirrors of tokens that live on Base. Their scale is decided by
--   the chain, a boot invariant requires them to hold no ledger rows here, and
--   `validateLeg` refuses to move them. Writing a scale onto a mirror would be
--   this database asserting something it does not decide.
--
-- VILLAGE VOICE MOVES FOR A DIFFERENT REASON AND IT IS THE OPPOSITE OF THE
-- INTUITION. Voice is always issued in whole units, so it looks like the token
-- that least needs a scale. It is the only one that WANES. `decayVoice` floors
-- each member's share and skips the member when the answer is zero, so at whole
-- numbers and the default one percent a member holding anything under a hundred
-- Voice never wanes at all, and nothing reports it, because skipping is the
-- ordinary path for a member with nothing to lose. The waning ruling would sit
-- in the settings, be displayed, and do nothing. At two decimals one percent
-- reaches a member holding a single whole Voice.
--
-- ── WHY THIS FILE REFUSES RATHER THAN ASSUMES ──────────────────────────────
--
-- A DECIMALS CHANGE IS A RESCALE IN BOTH DIRECTIONS. `token_ledger.amount`
-- holds MINOR units and `tokens.decimals` is the only thing that says how many,
-- so a stored 5 meaning five whole units becomes five hundredths the instant
-- this file runs, unless the data moves with it. Raising a token from zero to
-- two is as much a rescale as bringing Voice down from three. No invariant
-- fires either way: conservation holds at any scale and the balance cache still
-- agrees with the ledger it caches.
--
-- This village is safe by the ACCIDENT of an empty ledger and not by
-- construction. Thirteen founder instances run this image, and a fork that has
-- been issuing credits for a month is the case the guard below exists for. So
-- the file asserts the fact instead of trusting it, and it names the token it
-- refuses over, because "the migration failed" sends a reader to the wrong
-- place.
--
-- THE GUARD IS STRICTER THAN "ISSUED SUPPLY IS ZERO", DELIBERATELY. Per-token
-- SUM(balance) is identically zero by boot invariant, so a balance sum answers
-- nothing, and a faucet's negative balance sees only what was issued. It cannot
-- see a price a steward posted in a token nobody has spent yet, and that price
-- is stored in the same minor units and is corrupted by the same multiplication.
-- So the guard asks the widest honest question: does ANY row anywhere store an
-- amount denominated in this token. Eleven tables can, and all eleven are read.
-- `mint_rules.amount`, `mint_rules.ceiling` and `voice_claims.amount` are NOT
-- among them and are not a gap: those columns hold `decimal(18,4)` HUMAN units,
-- which mean the same thing at every scale. `onchain_balances.raw_balance` is
-- the chain's own scale for a hypha mirror, and no hypha token is touched here.
--
-- HOW IT REFUSES, since plain SQL has no conditional SIGNAL and this runner
-- splits statements on line-final semicolons so a stored procedure is not
-- available either. The offending rows are joined against a two-row constant,
-- which offers the SAME primary key value twice inside one INSERT. A duplicate
-- key is an error on MySQL 8 and on MariaDB, in every sql_mode, and the engine
-- prints the duplicated VALUE, so the refusal sentence and the token's slug
-- reach the operator in the error itself. When nothing offends, the subquery is
-- empty, the INSERT writes nothing, and the guard table stays EMPTY: a row in
-- it is never the healthy state.
--
-- ORDERING. The rule is that if the registry and the stored columns cannot move
-- in one transaction, the REGISTRY MOVES LAST, because a stale registry reads
-- too small while a fresh registry over unscaled data reads too large, and too
-- large is the one somebody acts on. Here there are no stored columns to move,
-- because the guard has already proved there are none. The registry update is
-- last in the file regardless, so the ordering is right by structure and not by
-- the guard happening to pass.
--
-- IDEMPOTENT. The guard re-reads the same empty answer and writes nothing. The
-- update is an assignment to a constant, so a second run sets the same values
-- and changes zero rows. Nothing here is an ALTER, so a re-run cannot brick
-- boot the way a repeated ADD COLUMN would.
--
-- EXPAND, NEVER CONTRACT. One new table, one UPDATE of an existing column's
-- VALUE, and no column or table is dropped or narrowed. The previous release
-- reads `tokens.decimals` through `decimalsFor` and converts with it, so it
-- reports the new scale correctly the moment it reads the row.

CREATE TABLE IF NOT EXISTS `_token_scale_guard` (
  -- The refusal sentence, which is also the key. A row here means 0162 refused.
  `refusal` varchar(190) NOT NULL,
  `noticed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`refusal`)
) ENGINE=InnoDB;

-- This statement READS `tokens` and writes only the guard table, so the token
-- doc generator is told to skip it. Without the directive it refuses to guess,
-- which is the behaviour that belongs in a generator and not a reason to
-- reshape a guard around a reader.
-- token-doc: ignore
INSERT INTO `_token_scale_guard` (`refusal`)
SELECT `offending`.`refusal`
FROM (
  SELECT DISTINCT
    CONCAT(
      'REFUSED by 0162: the token "', `t`.`slug`, '" already holds stored amounts, so changing its ',
      'decimals would rescale every one of them. Move the rows first.'
    ) AS `refusal`
  FROM `tokens` `t`
  JOIN (
    -- EVERY BRANCH IS FORCED TO ONE COLLATION, AND THIS MACHINE COULD HAVE
    -- TOLD US ALL ALONG.
    --
    -- These eleven tables do not share a collation. Seven migrations in this
    -- repository pin a CHARSET on the tables they create and the rest inherit
    -- the schema default, so on a database whose default is not the character
    -- set's own default the branches disagree and MySQL refuses the whole
    -- statement with "Illegal mix of collations for operation 'UNION'", and a
    -- schema that cannot migrate provisions nothing, so it took out every
    -- database-backed suite in CI.
    --
    -- I first wrote here that only CI could see it. That was wrong and it is the
    -- more useful half: server/db/collation.test.ts provisions its OWN schema at
    -- utf8mb4_general_ci and reproduces this exactly on the local MariaDB, five
    -- passed and twelve skipped, the same shape CI reported. It was never an
    -- engine gap. Nobody ran that suite, because it is in no lane's touched-file
    -- set, which is the same reason a rhythm guard sat red across two pushes.
    --
    -- `utf8mb4_bin` because a token slug is an identifier: byte-exact is the
    -- semantics we want, it is present on both engines, and it removes any
    -- chance of two slugs differing only by case being treated as one.
    SELECT `token_type` COLLATE utf8mb4_bin AS `slug` FROM `token_ledger`
    UNION ALL SELECT `token_type` COLLATE utf8mb4_bin FROM `token_balances` WHERE `balance` <> 0
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin FROM `admin_mint_requests`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin FROM `redemptions`
    UNION ALL SELECT `token_type` COLLATE utf8mb4_bin FROM `accommodation_prices`
    UNION ALL SELECT `seat_token` COLLATE utf8mb4_bin FROM `events` WHERE `seat_price` IS NOT NULL AND `seat_price` <> 0
    UNION ALL SELECT `token_type` COLLATE utf8mb4_bin FROM `event_seat_charges`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin FROM `currency_prices`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin FROM `exchange_orders`
    UNION ALL SELECT `pay_token_slug` COLLATE utf8mb4_bin FROM `exchange_orders`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin FROM `payment_products`
    UNION ALL SELECT `rate_snapshot_token` COLLATE utf8mb4_bin FROM `stays`
  ) `used` ON `used`.`slug` = `t`.`slug` COLLATE utf8mb4_bin
  WHERE (`t`.`kind` = 'credit' AND `t`.`governance` = 'platform')
     OR (`t`.`slug` = 'village-voice')
) `offending`
JOIN (SELECT 1 AS `n` UNION ALL SELECT 2) `twice`;

-- TWO STATEMENTS AND NOT ONE `OR`, for two reasons that agree. The tokens move
-- for DIFFERENT reasons and each statement now carries exactly one of them:
-- the first is the currency-like set, the second is the waning set. And
-- `whereMatcher` in scripts/generate-token-doc.mjs splits a WHERE on AND alone,
-- so an `OR` here would have needed a directive teaching a generated document
-- to read a shape written only to save a line.

UPDATE `tokens`
   SET `decimals` = 2
 WHERE `kind` = 'credit' AND `governance` = 'platform';

UPDATE `tokens`
   SET `decimals` = 2
 WHERE `slug` = 'village-voice';
