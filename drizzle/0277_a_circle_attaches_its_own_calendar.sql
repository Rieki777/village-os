-- 0277: a circle attaches its own calendar.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER.
--
-- THE CONTRACT IS shared/sessionCalendar.ts. Every door and sentence a member
-- reads is named there once.
--
-- WHAT IT HOLDS. Which external calendar belongs to which circle: a circle
-- that already keeps its meetings in Google Calendar, Apple or Outlook
-- attaches that calendar's secret address, and its meetings flow into Coming
-- up on /sessions, the day-before notice, and the calendars of members who
-- follow the circle. One calendar per circle.
--
-- THE CALENDAR ITSELF IS THE VILLAGE'S OWN SUBSCRIPTION (0085,
-- `external_calendars`): its address sealed in the secrets store and never
-- returned, fetched through the outbound guard every few hours, its events
-- imported onto the circle layer of the one calendar. This table only says
-- whose it is.
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in every
-- Live Sessions table. 0 means a member who has since left the village.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_circle_calendars` (
  -- A live circle's id. One calendar per circle.
  `circle_id` varchar(64) NOT NULL,
  -- The `external_calendars` row that holds its address and its imports.
  `external_calendar_id` varchar(64) NOT NULL,
  -- Who attached it.
  `set_by_no` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`circle_id`),
  KEY `live_session_circle_calendars_set_by_idx` (`set_by_no`)
);
