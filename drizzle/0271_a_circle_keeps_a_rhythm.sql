-- 0271: a circle keeps a rhythm: when it meets next.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER.
--
-- THE CONTRACT IS shared/sessionRhythm.ts. The kinds, the limits and every
-- sentence a member reads are named there once.
--
-- WHAT IT HOLDS. A circle's meeting rhythm: every week or every few weeks on
-- a weekday, at each new or full moon, or once on a date, at a time of day in
-- the village's own zone, for some minutes. "Coming up" on /sessions reads
-- the next meeting from it, the start card gets the room ready from it, and a
-- gentle notice reaches the circle's members the day before. Nothing opens a
-- room on its own: a person opens it, the way a person closes it.
--
-- THE RHYTHM IS THE CALENDAR'S OWN SHAPE. `recurrence` is the `Recurrence`
-- JSON of shared/gatherings.ts (weekly with an interval, or lunar on the new
-- or full moon, with skipped dates in `exceptions`), so a later wave can show
-- a circle's meetings on the village calendar without translating anything.
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in every
-- Live Sessions table. 0 means a member who has since left the village.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_rhythms` (
  -- A live circle's id. One rhythm per circle.
  `circle_id` varchar(64) NOT NULL,
  -- weekly, moon or once.
  `kind` varchar(8) NOT NULL,
  -- JSON: the calendar's Recurrence. NULL for a single meeting.
  `recurrence` text NULL,
  -- The village date of the first meeting, YYYY-MM-DD. A weekly rhythm
  -- counts its weeks from this date's week.
  `starts_on` varchar(10) NOT NULL,
  -- The time of day every meeting keeps, HH:MM, in the village's zone. A
  -- date and a wall-clock time, never an instant, so a daylight change or a
  -- new village zone leaves "Thursday at 18:00" where it was.
  `time_of_day` varchar(5) NOT NULL,
  `duration_min` smallint NOT NULL,
  -- Who set it last.
  `set_by_no` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set by every write: the column has no ON UPDATE.
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`circle_id`),
  KEY `live_session_rhythms_set_by_idx` (`set_by_no`)
);
