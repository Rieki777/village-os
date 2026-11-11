-- 0373: an org draft can set a circle's standing (operating or forming) and
-- mark it the anchor, as a proposal a person publishes. Expand only: the op
-- enum gains one value, and every earlier value stays.
ALTER TABLE `org_draft_changes`
  MODIFY COLUMN `op` enum('create_seat','create_circle','update_seat','rest_seat','seat_holder','end_holding','move_circle','rest_circle','update_circle','set_circle_standing') NOT NULL;
