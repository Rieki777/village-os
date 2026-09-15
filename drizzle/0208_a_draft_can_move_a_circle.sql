-- 0208: a reorganisation can MOVE A CIRCLE.
--
-- Until now a draft held seats, their circles and their holders, and never
-- where a circle itself sits, because `circles` is written through a cached
-- collection that cannot join the draft transaction. The drag on the living map
-- needs a move to be reviewable, publishable and revertable the way a seat
-- change is, so the move becomes an op, applied by raw SQL inside the publish
-- transaction and followed by a reload of that cache after commit.
--
-- EXPAND ONLY. This widens an enum by one value and removes none. An older
-- release reading a move_circle row finds no seat whose id is circle:<id>, so
-- it cannot move a seat by mistake. It would report such a draft published with
-- the move not made, and that is the whole cost of a rollback here.
ALTER TABLE `org_draft_changes`
  MODIFY COLUMN `op` enum('create_seat','update_seat','rest_seat','seat_holder','end_holding','move_circle') NOT NULL;
