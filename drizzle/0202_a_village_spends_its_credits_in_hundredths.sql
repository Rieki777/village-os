-- 0202: two decimals on what a village spends, and Voice comes down to two.
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
-- A TOKEN ALREADY AT TWO IS NOT REFUSED. The update writes 2 over 2 and moves
-- nothing, so a fork whose credit token already carries the currency scale has
-- nothing for the guard to protect, whatever it holds.
--
-- ── STANDING EXAMPLES ARE MOVED, NOT REFUSED ───────────────────────────────
--
-- `server/lib/examples.ts` seeds catalog rows with `is_example = 1` the moment
-- a module is on: room prices in `stay-credit` for stays, and example credit
-- tokens with posted prices for the exchange. Those rows hold no value, no
-- ledger row points at one, and every route refuses to act on them. A guard
-- that counted them refused boot on EVERY village that ever had stays or the
-- exchange on, which is most of them, over rows nobody owns.
--
-- So an example row is exempt from the guard exactly when this file can carry
-- it, and carrying it means different things for the two tables:
--
--   `accommodation_prices.amount_minor` is in the token's MINOR units
--   (`priceToStored`, server/lib/stays.ts), so a room priced 3 at scale 0
--   must read 300 at scale 2 or it becomes a room for three hundredths. It is
--   RESCALED below, for a platform credit token rising from 0 or 1.
--   `currency_prices.price_minor` is fiat CENTS per WHOLE token (`setPrice`
--   says cents, and the buy route charges `quantity * priceMinor` for a whole
--   quantity), so it means the same thing at every scale and is left alone.
--
-- An example row on any other token, or on a credit token coming DOWN to two,
-- still refuses: dividing a stored integer loses digits, and no shipped seed
-- writes one. A real row (`is_example = 0`) refuses exactly as it always did.
--
-- ── THE RESCALE MUST NOT MULTIPLY TWICE ────────────────────────────────────
--
-- A rescale written as `amount_minor = amount_minor * 100` is correct once and
-- wrong on every repeat, and repeats are real here. The runner records progress
-- in its OWN statement after each one succeeds (`recordProgress`,
-- server/db/migrate.ts), so a container stopped between the two resumes AT the
-- statement that already ran. Gating on "the token is still below two" does
-- not close that window, because the token has not moved yet either.
--
-- So the old value is written down first, keyed by the price row, and the
-- rescale ASSIGNS from that record instead of multiplying the live column:
--
--   The snapshot keeps the first value it saw for a row. A second pass over a
--   row it already holds changes nothing, so a rescaled 300 can never be taken
--   down as a new "before".
--   The rescale writes `before * factor`, a pure function of the snapshot, and
--   only while the row still holds `before` and the token still sits at the
--   scale the snapshot saw. A row already moved, or a token already at two,
--   matches nothing.
--
-- Run twice, resumed at any statement, or stopped between a statement and its
-- progress row, each example price ends at exactly one rescale.
--
-- ORDERING. The rule is that if the registry and the stored columns cannot move
-- in one transaction, the REGISTRY MOVES LAST, because a stale registry reads
-- too small while a fresh registry over unscaled data reads too large, and too
-- large is the one somebody acts on. The guard runs first, then the snapshot,
-- then the example rescale, and the registry updates are last in the file.
--
-- IDEMPOTENT. The guard re-reads the same empty answer and writes nothing. The
-- snapshot and the rescale are argued above. The registry updates are
-- assignments to a constant, so a second run sets the same values and changes
-- zero rows. Nothing here is an ALTER, so a re-run cannot brick boot the way a
-- repeated ADD COLUMN would.
--
-- EXPAND, NEVER CONTRACT. Two new tables, one UPDATE of example price VALUES
-- behind a WHERE, two UPDATEs of the registry's decimals VALUE, and no column
-- or table is dropped or narrowed. The previous release reads `tokens.decimals`
-- through `decimalsFor` and converts with it, so it reports the new scale
-- correctly the moment it reads the row.

CREATE TABLE IF NOT EXISTS `_token_scale_guard` (
  -- The refusal sentence, which is also the key. A row here means 0202 refused.
  `refusal` varchar(190) NOT NULL,
  `noticed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`refusal`)
) ENGINE=InnoDB;

-- The example prices this file rescales, as they stood before it touched them.
-- NO CHARSET IS PINNED, like the guard table above: the boot aligner
-- (`alignTableCollations`, server/db/collation.ts) rewrites any table that
-- disagrees with the schema default, and server/db/collation.test.ts caught a
-- pinned utf8mb4_bin here doing exactly that. Every join below forces
-- utf8mb4_bin on BOTH sides instead, so identifiers compare byte-exact
-- whatever the default is.
CREATE TABLE IF NOT EXISTS `_token_scale_example_prices` (
  `price_id` varchar(64) NOT NULL,
  `token_type` varchar(32) NOT NULL,
  `from_decimals` int NOT NULL,
  `amount_before` int NOT NULL,
  `noticed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`price_id`)
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
      'REFUSED by 0202: the token "', `t`.`slug`, '" already holds stored amounts, so changing its ',
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
    --
    -- `example_row` is 1 only on the two tables whose example rows this file
    -- can carry. Every other branch is 0, so an example row anywhere else
    -- still refuses.
    SELECT `token_type` COLLATE utf8mb4_bin AS `slug`, 0 AS `example_row` FROM `token_ledger`
    UNION ALL SELECT `token_type` COLLATE utf8mb4_bin, 0 FROM `token_balances` WHERE `balance` <> 0
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin, 0 FROM `admin_mint_requests`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin, 0 FROM `redemptions`
    UNION ALL SELECT `token_type` COLLATE utf8mb4_bin, `is_example` FROM `accommodation_prices`
    UNION ALL SELECT `seat_token` COLLATE utf8mb4_bin, 0 FROM `events` WHERE `seat_price` IS NOT NULL AND `seat_price` <> 0
    UNION ALL SELECT `token_type` COLLATE utf8mb4_bin, 0 FROM `event_seat_charges`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin, `is_example` FROM `currency_prices`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin, 0 FROM `exchange_orders`
    UNION ALL SELECT `pay_token_slug` COLLATE utf8mb4_bin, 0 FROM `exchange_orders`
    UNION ALL SELECT `token_slug` COLLATE utf8mb4_bin, 0 FROM `payment_products`
    UNION ALL SELECT `rate_snapshot_token` COLLATE utf8mb4_bin, 0 FROM `stays`
  ) `used` ON `used`.`slug` = `t`.`slug` COLLATE utf8mb4_bin
  WHERE ((`t`.`kind` = 'credit' AND `t`.`governance` = 'platform') OR (`t`.`slug` = 'village-voice'))
    -- A token already at two does not change scale, so nothing it holds moves.
    AND `t`.`decimals` <> 2
    -- An example row the rescale below carries, on a credit token rising to two.
    AND NOT (`used`.`example_row` = 1 AND `t`.`kind` = 'credit' AND `t`.`governance` = 'platform' AND `t`.`decimals` < 2)
) `offending`
JOIN (SELECT 1 AS `n` UNION ALL SELECT 2) `twice`;

-- THE SNAPSHOT. Every example room price in a platform credit token still below
-- two, with the scale and the amount it holds right now. A row already recorded
-- keeps its first record: the duplicate branch assigns the key to itself and
-- touches neither `from_decimals` nor `amount_before`.
-- On a fresh install no example row exists yet when this runs, so it changes
-- nothing the token doc describes.
-- token-doc: ignore
INSERT INTO `_token_scale_example_prices` (`price_id`, `token_type`, `from_decimals`, `amount_before`)
SELECT `ap`.`id`, `ap`.`token_type`, `t`.`decimals`, `ap`.`amount_minor`
FROM `accommodation_prices` `ap`
JOIN `tokens` `t` ON `t`.`slug` COLLATE utf8mb4_bin = `ap`.`token_type` COLLATE utf8mb4_bin
WHERE `ap`.`is_example` = 1
  AND `t`.`kind` = 'credit'
  AND `t`.`governance` = 'platform'
  AND `t`.`decimals` < 2
ON DUPLICATE KEY UPDATE `price_id` = `_token_scale_example_prices`.`price_id`;

-- THE RESCALE, by exactly the scale change, assigned from the snapshot. The
-- factor is a CASE over the two starting scales the snapshot admits, so the
-- arithmetic stays integer. The last three clauses are what make a repeat
-- match nothing: the row still holds what the snapshot saw, the token has not
-- moved since, and the starting scale is one the factor covers.
-- token-doc: ignore
UPDATE `accommodation_prices` `ap`
JOIN `_token_scale_example_prices` `s` ON `s`.`price_id` COLLATE utf8mb4_bin = `ap`.`id` COLLATE utf8mb4_bin
JOIN `tokens` `t` ON `t`.`slug` COLLATE utf8mb4_bin = `ap`.`token_type` COLLATE utf8mb4_bin
SET `ap`.`amount_minor` = `s`.`amount_before` * (CASE `s`.`from_decimals` WHEN 0 THEN 100 WHEN 1 THEN 10 END)
WHERE `ap`.`is_example` = 1
  AND `s`.`token_type` COLLATE utf8mb4_bin = `ap`.`token_type` COLLATE utf8mb4_bin
  AND `ap`.`amount_minor` = `s`.`amount_before`
  AND `t`.`decimals` = `s`.`from_decimals`
  AND `s`.`from_decimals` IN (0, 1);

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
