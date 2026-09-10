-- An erasure records how far it got.
--
-- WHAT WAS WRONG.
-- `anonymizeMember` (server/lib/erasure.ts) is a sequence of about twenty
-- writes across eighteen tables, four helper modules and three repositories.
-- It had no transaction, no error handling and no record of itself. A failure
-- part way through (a dropped connection, a lock timeout, a process restart
-- during a deploy) left a member half-erased: some tables scrubbed, some not,
-- the tombstone possibly written and possibly not, and NOTHING anywhere saying
-- that an erasure had been started and not finished. Nobody could see it,
-- nothing would retry it, and the member had been told "deleted".
--
-- WHY A TABLE AND NOT A TRANSACTION.
-- The full argument is in the header of `server/lib/erasure.ts`, because that
-- is where somebody deciding to "just wrap it" will be standing. In one line:
-- the sequence CANNOT be one transaction. `submissionsRepo`, `roleHoldersRepo`
-- and `members` are `dbCollection` repositories that hold their own in-memory
-- caches and take their own connections, `forgetMemberEverywhere` makes
-- network calls to outside vendors, and a transaction cannot span any of that.
-- A wrapper around the fourteen statements that COULD join one would leave the
-- other half outside it and still fail half way, while looking closed.
--
-- So the sequence is made RESUMABLE instead: every step is idempotent by
-- construction, this table records which ones finished, and the steward's
-- erasure queue finishes what a failure left.
--
-- WHY `finished_at` IS THE SIGNAL AND NOT A STATUS ENUM.
-- A row with `finished_at IS NULL` is an unfinished erasure whether the process
-- threw, was killed, or is still running. A status column would have to be
-- WRITTEN to say "crashed", and a crash is precisely the case where nothing
-- gets written. The absence of a completion is the only failure report that
-- survives the failure it reports.
--
-- WHY `steps_done` IS A HINT AND NOT THE CORRECTNESS ARGUMENT.
-- A step is recorded after it lands, so a death between the write and the
-- record leaves a completed step unrecorded. That is safe and deliberate: a
-- resume re-runs it, and every step is idempotent, so re-running one costs a
-- second UPDATE that matches nothing. The reverse, recording a step before it
-- lands, would let a resume skip work that never happened, which is the one
-- direction this must never fail in.
--
-- EXPAND ONLY. A new table with no foreign key. The previous release neither
-- reads nor writes it, so a rollback over this migration is a no-op and the
-- rows it leaves behind are an inert record of erasures that did finish.

CREATE TABLE IF NOT EXISTS `member_erasures` (
  -- The member being erased. One row per member: an erasure is not an event
  -- somebody accumulates, it is a state that is either finished or is not.
  `user_id` varchar(64) NOT NULL,
  -- When the FIRST attempt began. Never moved forward by a resume, for the
  -- reason `subject_refs.erasure_pending_since` is never moved forward: the
  -- age of an obligation that resets whenever somebody tries is a number that
  -- never grows old enough for anyone to escalate.
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL means the local sweep has not completed. This is the queue's whole
  -- question.
  `finished_at` timestamp NULL,
  -- How many times the sweep has been run for this member, first attempt
  -- included. A member on attempt nine is a different conversation from one on
  -- attempt two, and the difference is invisible from a date alone.
  `attempts` int NOT NULL DEFAULT 0,
  `last_attempt_at` timestamp NULL,
  -- The names of the steps that have landed, as a JSON array of strings. The
  -- names are `server/lib/erasure.ts`'s own step names and are matched back to
  -- it by string, so renaming one there makes a resume re-run it, which is the
  -- safe direction.
  `steps_done` json NULL,
  -- The step that was running when the last attempt stopped, and what it said.
  -- Cleared on success. A steward reading the queue needs a name to press and
  -- a sentence to paste, not a count.
  `failed_step` varchar(64) NULL,
  `last_error` varchar(500) NULL,
  PRIMARY KEY (`user_id`)
);

-- Read by the steward's queue, which asks for unfinished sweeps oldest first.
CREATE INDEX `member_erasures_unfinished_idx` ON `member_erasures` (`finished_at`, `started_at`);
