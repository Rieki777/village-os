-- 0210: a consent remembers what it owes.
--
-- WHAT WAS WRONG.
-- A consent moves three kinds of value. Recognition posts inside the consent's
-- own commit (`consentOnce` in server/repos/quests.ts), so it cannot be lost.
-- The `quest.completed` rule tokens and a quest's stay credits posted AFTER that
-- commit, best effort: a failed post was logged and never retried, and
-- consenting again is refused once a claim is consented. A member who was
-- witnessed and credited could be owed voice, credits or stay credits that
-- nothing would ever pay, and nothing anywhere recorded that they were owed.
--
-- WHAT THIS TABLE IS.
-- One row per posting a consent owes, written in the consent's own commit, so
-- the obligation exists exactly when the consent does. A row is paid in a later
-- transaction that locks it, posts it through the ledger (`postOwedOn`) and
-- marks it posted in the same commit, so a posting and its record never come
-- apart. The attempt made straight after the consent and a steward's retry are
-- the same transaction.
--
-- WHY NOTHING CAN PAY TWICE.
-- The primary key is the ledger's own occurrence key, exactly the key the direct
-- path always posted (`queststay:<claim>` and the `quest.completed` key ending in
-- the token). Pricing one consent twice cannot insert a second row. Posting a
-- row whose ledger row already exists answers duplicate from the unique index on
-- `token_ledger.idempotency_key` and moves nothing, and the row is then marked
-- posted, which is true.
--
-- WHY `state` IS A STRING.
-- owed, posted or refused. A later state is a new value in code and never an
-- ALTER on thirteen instances. `refusal_reason` records the ledger's answer as
-- a fact: `not_launched` leaves the row owed, because launching makes it
-- payable, and `key_clash` and `rule` mark it refused, because no retry can
-- succeed. An infrastructure failure writes nothing and leaves the row owed.
--
-- NO CHARSET CLAUSE, deliberately, for 0198's and 0201's reason: the table
-- inherits the schema's, so a join to `token_ledger` on the key compares like
-- with like on every instance.
--
-- EXPAND ONLY. A new table with no foreign key. The previous release neither
-- reads nor writes it, so a rollback over this migration is a no-op.

CREATE TABLE IF NOT EXISTS `quest_owed_postings` (
  -- The ledger occurrence key this posting carries, at the width of
  -- `token_ledger.idempotency_key`. One row per occurrence.
  `idempotency_key` varchar(191) NOT NULL,
  -- The consented claim that owes it, at the width of `quest_claims.id`.
  `claim_id` varchar(64) NOT NULL,
  -- The member it is owed to, at the width of `users.id`.
  `to_user_id` varchar(64) NOT NULL,
  -- At the width of `tokens.slug`.
  `token_slug` varchar(32) NOT NULL,
  -- Minor units, always above zero, and the scale they are in.
  `units` bigint NOT NULL,
  `decimals` tinyint NOT NULL,
  -- The faucet account it issues from, at the width of `token_ledger.from_account`.
  `from_account` varchar(80) NOT NULL,
  -- The next three at the widths `token_ledger` stores them in.
  `source` varchar(64) NOT NULL,
  `source_ref` varchar(120) NOT NULL,
  `description` varchar(500) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'owed',
  `refusal_reason` varchar(32) NULL,
  `last_error` varchar(500) NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `settled_at` timestamp NULL,
  PRIMARY KEY (`idempotency_key`),
  KEY `quest_owed_postings_claim` (`claim_id`),
  KEY `quest_owed_postings_state` (`state`, `created_at`)
) ENGINE=InnoDB;
