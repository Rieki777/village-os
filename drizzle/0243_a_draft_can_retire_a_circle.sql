-- 0243: a draft can retire a circle.
--
-- WHAT IT IS FOR.
-- The structure change review lets a steward accept an outside service's new
-- chart and retire the old one in the same change. A seat already had its op
-- (`rest_seat`). A circle had none, so an old chart could only be retired by
-- hand, circle by circle, after the new one had published.
--
-- WHAT THIS CHANGES.
-- One enum value. `rest_circle` joins the ops a draft change may carry, and
-- `server/lib/orgDrafts.ts` gains its preview, apply and revert paths in the
-- same change. Applying it sets the circle `dormant`, the status the old
-- chart's retire list names as the safe first step, and the publish route runs
-- the dormancy hook on it afterwards, as every other writer of that status
-- does. The preview refuses a circle anything still sits in.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Adding a value to an enum is expand-only: the previous release reads and
-- writes every value it already knew, and it never writes this one. Same shape
-- as 0208 (`move_circle`) and 0224 (`create_circle`).

ALTER TABLE `org_draft_changes`
  MODIFY COLUMN `op` enum('create_seat','create_circle','update_seat','rest_seat','seat_holder','end_holding','move_circle','rest_circle') NOT NULL;
