-- 0208: a reorganisation can MOVE A CIRCLE.
--
-- Until now a draft held seats, their circles and their holders, and never
-- where a circle itself sits, because `circles` is written through a cached
-- collection that cannot join the draft transaction. The drag on the living map
-- needs a move to be reviewable, publishable and revertable the way a seat
-- change is, so the move becomes an op, applied by raw SQL inside the publish
-- transaction and followed by a reload of that cache after commit.
--
-- A move names its circle as circle:<id> in `org_role_id`. A circle id can be
-- 64 characters and that column was 64 wide, so the prefix pushed a long id
-- past it and the change could never be written. The column widens here.
--
-- EXPAND ONLY. One enum value is added and none removed, and a varchar grows.
-- An older release does not know the op. Its preview finds no seat whose id is
-- circle:<id> and blocks the line, so it refuses to publish such a draft. Its
-- revert of a draft this release published matches no seat, so it changes
-- nothing and still marks the draft reverted while the circle stays where it
-- was moved. That is the whole cost of a rollback here.
ALTER TABLE `org_draft_changes`
  MODIFY COLUMN `op` enum('create_seat','update_seat','rest_seat','seat_holder','end_holding','move_circle') NOT NULL;
ALTER TABLE `org_draft_changes`
  MODIFY COLUMN `org_role_id` varchar(96) NOT NULL;
