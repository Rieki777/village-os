-- 0280: a decision names when it is reviewed.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER.
--
-- THE CONTRACT IS shared/sessionDecisions.ts. Every door and sentence a member
-- reads is named there once.
--
-- WHAT IT HOLDS. A decision a circle made by consent (a `decision` entry its
-- room marked decided) can carry a review date: the village date the circle
-- looks at it again, the sociocratic habit of every agreement being good
-- until reviewed. When the date comes, a daily job makes "Review: <the
-- decision>" one of the circle's agenda items (0279 records it came from the
-- decision), so the circle's next session finds it with the rest. The
-- decision's own record is never written to: a closed session keeps its
-- record as it was, and the review lives here beside it.
--
--   review_on   the village date, YYYY-MM-DD
--   library_id  the agenda item the review became, once it was made; a new
--               review date set after that starts the next cycle afresh
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in every
-- Live Sessions table. 0 means a member who has since left the village.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_decision_reviews` (
  -- The decision: a `live_session_entries` row of kind `decision`.
  `entry_id` int NOT NULL,
  `review_on` varchar(10) NOT NULL,
  -- Who set the date last.
  `set_by_no` int NOT NULL DEFAULT 0,
  `library_id` int NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set by every write: the column has no ON UPDATE.
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`entry_id`),
  KEY `live_session_decision_reviews_due_idx` (`review_on`),
  KEY `live_session_decision_reviews_set_by_idx` (`set_by_no`)
);
