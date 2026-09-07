-- 0182: one gift, one key.
--
-- Two doors write a gratitude gift and each wrote its ledger posting under a
-- different occurrence key. `give()` in server/lib/economy.ts posts under
-- `keys.gratitudeGiven`, which is `gratitude.given:<esc(village)>:<esc(noteId)>`.
-- `sendGratitude()` in server/lib/gratitude.ts posted under a hand-built
-- `gratitude_received:<noteId>`, which carries no village at all.
--
-- The allowance's refund arm (`gratitudeGivenInCycle`, server/lib/economy.ts)
-- recovers the giver by rebuilding the keys that member's notes were posted
-- under, with `keys.gratitudeGiven`, and keeping only the reversal mirrors
-- whose `source_ref` matches one. A note written through the acknowledgement
-- door carried a key that builder can never produce, so its mirror matched
-- nothing and reversing that gift refunded the giver nothing. The village's
-- own `gratitude_allowance_given` snapshot (server/lib/health.ts) narrows on
-- the same prefix and was short by the same rows.
--
-- The code now has one builder on both doors. This file brings the live rows
-- to it, and it MOVES NO VALUE: `amount`, `from_account`, `to_account`,
-- `token_type` and `source_ref` are untouched, so per-token SUM(balance) is
-- the same number after this file as before it, and `token_balances` is a
-- cache recomputed from rows this file does not change.
--
-- WHY THE MAPPING IS ONE TO ONE, which is the thing to be sure of before
-- rewriting an identifier that a UNIQUE index calls a duplicate:
--
--   1. The map is `gratitude_received:<noteId>` -> `gratitude.given:<village>:<noteId>`,
--      and the note id is carried through unchanged. Two different note ids can
--      never produce one key, because the id is the last segment and nothing is
--      padded, folded or truncated on the way.
--   2. It cannot collide with a key already in the table. The target shape is
--      only ever written for the note whose id it ends in, `gratitude_log`.`id`
--      is the PRIMARY KEY of that table, and one note is posted by exactly one
--      door, so no second row can already hold the target key.
--      If one somehow does, this statement FAILS on the UNIQUE index rather
--      than skipping. That is deliberate and it follows 0105: a silent skip
--      here leaves a member's refund quietly broken, which is the whole defect
--      this file exists to close.
--   3. It cannot disturb the join in `server/lib/ledger.ts` that pairs a
--      gratitude row to its note, because that join reads `source_ref` and
--      `to_account` and this file writes neither.
--   4. The previous release still runs against the result. It looks a
--      gratitude key up only when re-posting the same note id, and a note id
--      is minted fresh per send, so no lookup it can make goes through the
--      renamed rows. It keeps writing the old shape for new notes, which the
--      next run of this file's successor would repair the same way.
--
-- WHAT IT REFUSES TO TOUCH, AND HOW TO FIND THOSE ROWS. A repair that guesses
-- is worse than one that refuses, so every clause below is a proof obligation
-- and a row that fails any of them keeps its old key.
--
--   - A row whose `source_ref` names no `gratitude_log` row. There is no
--     honest way to decide which village it belonged to: `token_ledger` has no
--     `village_id` column, so the note is the only witness. The inner join
--     drops it.
--   - A row whose note id or whose village id is changed by `esc`, the
--     percent-escape `keys.gratitudeGiven` applies to every segment (`%`, `:`
--     and every capital). Rebuilding that escape in SQL would be a second copy
--     of a rule that already has one home, so this file asks the weaker and
--     provable question instead: it repairs only the rows the escape leaves
--     alone. Every id this build mints is `grat-<epoch ms>-<6 of base 36>` and
--     every village id is `LOCAL_VILLAGE`, so both are escape-neutral and the
--     restriction excludes nothing a village can currently hold. A fork whose
--     village id carries a capital or a colon is the case it protects.
--   - A row that ALREADY HAS A REVERSAL MIRROR. `reverse()` derives its mirror
--     key as `reversal:<village>:<the original key>`, so renaming an original
--     out from under a stored mirror would leave the second reversal of that
--     gift colliding with nothing, and the recipient would be debited twice.
--     A rename can mint, and this is the direction it mints in here. No such
--     mirror can exist in this build (the only two callers of `reverse()` are
--     in server/lib/voiceClaim.ts and both pass a voice-claim debit key), and
--     the guard is here so the statement is correct on its own terms and not
--     because of a fact living in another file.
--
-- Every refusal leaves a row that is still shaped `gratitude_received:%`, so
-- one query finds all of them at once. docs/ECONOMICS.md section 10 carries it
-- and says what an operator does with the answer.
--
-- IDEMPOTENT. The statement is an UPDATE whose WHERE clause stops matching the
-- moment it has run: a repaired key begins `gratitude.given:` and its first
-- nineteen bytes are no longer `gratitude_received:`. A second run changes
-- zero rows. Nothing here is an ALTER, so a re-run cannot brick boot the way a
-- repeated ADD COLUMN would.
--
-- THE BINARY CASTS ARE NOT DECORATION. `idempotency_key` answers under a
-- case-insensitive collation, and the local engine is MariaDB (PAD SPACE)
-- while CI and the fleet run MySQL 8 (NO PAD). Compared as characters, the two
-- engines disagree about trailing spaces and both of them fold case, which
-- would let a key this file cannot prove is escape-neutral through the guard.
-- Compared as bytes, every clause below means the same thing on both engines.

UPDATE `token_ledger` `t`
  JOIN `gratitude_log` `g`
    ON `g`.`id` = `t`.`source_ref`
  LEFT JOIN `token_ledger` `m`
    ON `m`.`source` = 'reversal'
   AND `m`.`source_ref` = `t`.`idempotency_key`
  SET `t`.`idempotency_key` =
        CONCAT('gratitude.given:', `g`.`village_id`, ':', SUBSTRING(`t`.`idempotency_key`, 20))
  WHERE `t`.`source` IN ('gratitude_received', 'heart_received')
    AND `m`.`id` IS NULL
    AND CAST(LEFT(`t`.`idempotency_key`, 19) AS BINARY) = CAST('gratitude_received:' AS BINARY)
    AND CAST(`t`.`source_ref` AS BINARY) = CAST(SUBSTRING(`t`.`idempotency_key`, 20) AS BINARY)
    AND LOCATE('%', SUBSTRING(`t`.`idempotency_key`, 20)) = 0
    AND LOCATE(':', SUBSTRING(`t`.`idempotency_key`, 20)) = 0
    AND CAST(SUBSTRING(`t`.`idempotency_key`, 20) AS BINARY)
        = CAST(LOWER(SUBSTRING(`t`.`idempotency_key`, 20)) AS BINARY)
    AND LOCATE('%', `g`.`village_id`) = 0
    AND LOCATE(':', `g`.`village_id`) = 0
    AND CAST(`g`.`village_id` AS BINARY) = CAST(LOWER(`g`.`village_id`) AS BINARY)
    AND CHAR_LENGTH(
          CONCAT('gratitude.given:', `g`.`village_id`, ':', SUBSTRING(`t`.`idempotency_key`, 20))
        ) <= 191;
