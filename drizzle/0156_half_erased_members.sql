-- A member the village half-erased, and the two things a steward needs to end it.
--
-- WHAT THIS IS FOR.
-- `forgetMemberEverywhere` retires a member's subject reference only when every
-- registered store confirmed the deletion. When one does not confirm, the
-- mapping is KEPT on purpose: rule 2 of server/lib/memberDrivers.ts says the
-- village keeps owing that member a confirmation, and chasing it later means
-- asking about them again, which needs the reference to still resolve.
--
-- THE HOLE THAT LEAVES, WHICH IS WHY THIS MIGRATION EXISTS.
-- A kept mapping had no expiry and nobody watching it. "Kept because we still
-- owe you a confirmation" becomes "kept forever" the first time a vendor goes
-- dark and never answers, and the state is then decided by a third party's
-- silence rather than by anybody in the village. A departed member whose link
-- is held indefinitely, invisibly, is the exact shape of honest-looking failure
-- this codebase keeps producing: nothing is wrong, nothing is red, and nobody
-- can see it.
--
-- WHY BOTH COLUMNS AND NOT JUST THE DATE.
-- A timestamp alone gives a steward the scale and no handle. "Three members are
-- half-erased, the oldest 94 days" says there is a problem and names nobody to
-- press. `ErasureOutcome.unconfirmed` is already an array of module and detail
-- at the moment this row is written, so storing the date alone throws away
-- information the village already had. With both, the sentence becomes "three
-- members are half-erased, all waiting on saberra, the oldest 94 days", which
-- somebody can act on without opening a database.
--
-- `erasure_pending_since` is written once and never moved forward by a failed
-- retry, so the age is the age of the OBLIGATION rather than the age of the
-- last attempt. A number that resets every time somebody tries is a number that
-- never grows, and an obligation that never looks old is one nobody ends.
--
-- EXPAND ONLY. Two nullable columns on a table one release old. The previous
-- release reads and writes this table without them, so a rollback over this
-- migration is a no-op.

ALTER TABLE `subject_refs`
  ADD COLUMN `erasure_pending_since` timestamp NULL;

ALTER TABLE `subject_refs`
  ADD COLUMN `erasure_unconfirmed` json NULL;

-- Read by the steward's queue, which asks for pending rows oldest first.
CREATE INDEX `subject_refs_pending_idx` ON `subject_refs` (`erasure_pending_since`);
