-- 0294: a member is shown what landed for them, once, on whichever device they open.
--
-- WHAT THIS IS FOR.
-- Rye, 2026-10-30, earnings idea 1: when a member next opens the app after
-- tokens, Voice or a cash payment arrived for them, they get one short
-- celebration naming what came in and what it was for. It must never replay,
-- and a member with a phone and a laptop must not see it twice, so "already
-- celebrated" lives here and not in the browser.
--
-- ONE ROW PER ARRIVAL SHOWN. `arrival_key` names the thing that landed:
-- `ledger:<token_ledger.id>` for a work credit, `cash:<cash_owed.id>` for a
-- cash payment marked paid. The ledger and `cash_owed` are only read; nothing
-- here writes either of them.
--
-- THE BASELINE ROW. The first time a member is asked about, one row with the
-- key `baseline` is written and its `seen_at` is the moment arrivals start
-- counting from. Everything earned before that is history, which is the same
-- rule the client's arrival detection follows: the first reading seeds in
-- silence. Without it, every member's first open after this ships would throw
-- a season of old work at them at once.
--
-- The key is NOT NULL because MySQL unique indexes exempt NULLs.
CREATE TABLE IF NOT EXISTS `reward_moment_seen` (
  `user_id` varchar(64) NOT NULL,
  `arrival_key` varchar(191) NOT NULL,
  `seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `arrival_key`)
);
