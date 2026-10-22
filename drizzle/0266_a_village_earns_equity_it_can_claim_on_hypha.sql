-- 0266: equity a village can earn in its own game, and claim across to Hypha.
--
-- WHY A SECOND EQUITY TOKEN. The `equity` row is the Hypha mirror: a number
-- this village reads from Base and is forbidden to move. `validateLeg` refuses
-- any posting of a hypha-governed token and every boot refuses to start while
-- one has a ledger row, and that refusal is what lets a member trust the
-- on-chain figure. So equity cannot ACCRUE there. It accrues here, in a
-- platform token the village pays through its own mint rules, and a member
-- claims it across to Hypha later through the same claim machinery Village
-- Voice uses (server/lib/voiceClaim.ts). The pair has the same shape as the
-- voice pair: `voice` is the mirror and `village-voice` accrues.
--
-- THE NAME. The mirror's platform default is "Village Equity" (0124), so the
-- accruing twin cannot carry that name or any member reading two balances
-- would be unable to tell them apart. It ships as "Earned Equity" and, like
-- every platform token, a village renames it in Admin then Tokens. The SLUG is
-- permanent from this file on, which is why it names what the token is and
-- carries no village's word.
--
-- THE SHAPE, and each column is a decision:
--   kind 'equity'         the exit levers already key a share on it
--                         (`exit.keep_pct.equity`), and the exchange refuses
--                         every kind but credit, so it can never be sold.
--   governance 'platform' this ledger mints it. That is the whole point.
--   transferable 0        nothing share-like moves between members, and the
--                         boot invariant refuses any non-credit token marked
--                         transferable.
--   decimals 0            the column default. Whole units, so a rule cannot
--                         post a fraction that truncates to nothing.
--   sort_order 2          beside its mirror in every list sorted by it.
--
-- THE THREE ACCOUNTS. The mint is a faucet, so its negative balance IS the
-- earned equity issued to date. The bridge and the settled account are NOT
-- faucets: equity held against an open claim came from a member, and a faucet
-- there would let a claim create the equity it claims. Same three roles as
-- sys:voice-mint, sys:voice-bridge and sys:voice-settled (0072, 0076).
--
-- NO MINT RULE PAYS IT HERE. `seedEconomy` (server/lib/economySeed.ts) seeds
-- its two rules switched off, because there is no route that creates a mint
-- rule and a village decides what pays equity.
--
-- IDEMPOTENT BY CONSTRUCTION. Every statement is INSERT IGNORE on a primary
-- key, so a second run inserts nothing and a renamed token keeps its name.
-- server/earnedEquity.migration.test.ts runs this file a second time against a
-- migrated schema and asserts nothing changed.
--
-- THE ONE WAY THIS MISREADS. A village that already created a platform token
-- under the slug `earned-equity` by hand keeps that row as it is, and this
-- build then treats it as the claimable equity token. No fresh instance can be
-- in that state: a fresh registry holds no such slug.
--
-- EXPAND, NEVER CONTRACT. Two keyed inserts and no DDL. The release before
-- this one reads the same columns at the same types and simply never names
-- the new rows.

INSERT IGNORE INTO `tokens` (`slug`, `name`, `kind`, `governance`, `transferable`, `sort_order`) VALUES
  ('earned-equity', 'Earned Equity', 'equity', 'platform', 0, 2);

INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES
  ('sys:equity-mint', 'system', NULL, 'Earned equity mint', 1),
  ('sys:equity-bridge', 'system', NULL, 'Earned equity held for an open claim', 0),
  ('sys:equity-settled', 'system', NULL, 'Earned equity whose claim Hypha confirmed', 0);
