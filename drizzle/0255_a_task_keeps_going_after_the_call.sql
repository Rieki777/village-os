-- 0255: a task keeps going after the call.
--
-- Three new tables and one backfill into the first of them, so this file is
-- expand-only: the previous release neither reads nor writes any of them, and
-- rolling an image back over a migrated database leaves three tables nobody
-- asks about. No ALTER and no ADD COLUMN. A column a later wave needs
-- (`hand_asked_at`) is created now for the same reason.
--
-- THE CONTRACT IS shared/sessionTasks.ts. The statuses, the answer kinds and
-- the note's width are named there once, and the widths below follow them.
--
-- THE RECORD STAYS AS SAID. The words a session wrote down never change after
-- close: `live_session_entries` and the frozen minutes are left alone. What
-- happens to an action afterwards lives here: where it stands now, every
-- answer given to it, and every time a session's task emails went out.
--
-- A PERSON HERE IS A NUMBER from `live_session_members`, the same as in the
-- six tables 0238 made, and every person column ends in `_no`. 0 means as
-- closed, or a member who has since left the village.
--
-- NO FOREIGN KEYS, the same as every table in this schema. Erasure
-- (`forgetMemberSessions` in server/lib/liveSessions.ts) deletes the state
-- and events of the entries the leaver wrote, takes them off the tasks they
-- held, and sets 0 or NULL wherever else they appear, notes included.

-- One row per action open or done at close: where it stands now.
CREATE TABLE IF NOT EXISTS `live_session_task_state` (
  `entry_id` int NOT NULL,
  `session_id` int NOT NULL,
  -- Copied from live_sessions so a circle's open tasks read on one index.
  `circle_id` varchar(64) NULL,
  -- open, done or let_go. open with no owner and no seat is back with the circle.
  `status` varchar(12) NOT NULL DEFAULT 'open',
  `owner_no` int NULL,
  `owner_seat_id` varchar(64) NULL,
  `due_on` date NULL,
  -- The kind of the last answer (closed, done, not_yet, let_go, handed_back, taken, reopened).
  `latest_kind` varchar(16) NOT NULL DEFAULT 'closed',
  -- The one line given with the last answer, if any.
  `latest_note` varchar(300) NULL,
  -- Reserved for "I could use a hand" (a later wave).
  `hand_asked_at` timestamp NULL,
  -- live_session_members.no of who answered last. 0 means as closed, or a member who has left.
  `changed_by_no` int NOT NULL DEFAULT 0,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `done_at` timestamp NULL,
  -- Goes up by one on every answer. The board's optimistic lock.
  `version` int NOT NULL DEFAULT 1,
  PRIMARY KEY (`entry_id`),
  KEY `live_session_task_state_owner_idx` (`owner_no`, `status`),
  KEY `live_session_task_state_seat_idx` (`owner_seat_id`, `status`),
  KEY `live_session_task_state_session_idx` (`session_id`),
  KEY `live_session_task_state_circle_idx` (`circle_id`, `status`, `changed_at`),
  KEY `live_session_task_state_due_idx` (`status`, `due_on`)
);

-- Every answer, in order. Append-only.
CREATE TABLE IF NOT EXISTS `live_session_task_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entry_id` int NOT NULL,
  `session_id` int NOT NULL,
  -- done, not_yet, let_go, handed_back, taken, reopened.
  `kind` varchar(16) NOT NULL,
  `by_no` int NOT NULL,
  -- The state after this answer.
  `status` varchar(12) NOT NULL,
  `owner_no` int NULL,
  `owner_seat_id` varchar(64) NULL,
  `due_on` date NULL,
  `note` varchar(300) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `live_session_task_events_entry_idx` (`entry_id`, `id`),
  KEY `live_session_task_events_by_idx` (`by_no`)
);

-- Each time a session's task emails went out. send_no 1 is the close.
CREATE TABLE IF NOT EXISTS `live_session_task_sends` (
  `session_id` int NOT NULL,
  `send_no` int NOT NULL,
  -- 0 means sent by the close itself.
  `sent_by_no` int NOT NULL DEFAULT 0,
  `sent_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- JSON counts by outcome. Numbers only, never addresses.
  `counts` varchar(400) NOT NULL DEFAULT '{}',
  PRIMARY KEY (`session_id`, `send_no`)
);

-- The sessions already closed (the first real calls) get their state rows now.
-- An open action nobody holds gets one too: it is back with the circle.
-- INSERT IGNORE, so a second run changes nothing: a row that exists keeps
-- every answer it has been given. server/repos/sessionTasks.ts
-- `seedStateForSession` runs the same statement for one session at its close.
INSERT IGNORE INTO `live_session_task_state`
  (`entry_id`, `session_id`, `circle_id`, `status`, `owner_no`, `owner_seat_id`, `due_on`,
   `latest_kind`, `changed_by_no`, `changed_at`, `done_at`)
SELECT e.`id`, e.`session_id`, s.`circle_id`, e.`status`, NULLIF(e.`owner_no`, 0), e.`owner_seat_id`, e.`due_on`,
       'closed', 0, COALESCE(s.`closed_at`, CURRENT_TIMESTAMP),
       CASE WHEN e.`status` = 'done' THEN s.`closed_at` ELSE NULL END
FROM `live_session_entries` e
JOIN `live_sessions` s ON s.`id` = e.`session_id`
WHERE s.`status` = 'closed' AND e.`kind` = 'action' AND e.`status` IN ('open', 'done');
