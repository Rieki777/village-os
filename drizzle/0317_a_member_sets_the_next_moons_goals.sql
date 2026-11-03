-- Moon goals and the score (decision 20, 3 November; spec section 16).
--
-- At each new moon a member scores the goals of the moon just ended and sets
-- three to five goals for the next. moon_goals holds them, one row per goal
-- per member per moon, and carries an unfinished goal into the next moon with
-- carry_count one higher (carried twice is flagged for the circle). Every
-- column a unique key reads is NOT NULL. Statuses are varchar, never ENUM.
--
-- moon_recap_items gains how a piece of work ended this moon (task_status:
-- done, partly, carry, let_go, redirect), who it belongs to when redirected,
-- why it was let go, the day it was set (the score counts this moon's tasks
-- only), and, for Outside my roles work, the role it really belongs to.
--
-- moon_recaps gains the score as written at send, in half-points so nothing
-- stored is a decimal. No column here carries hours or minutes.
--
-- Expand only: one new table and nullable columns on tables 0313 made.

CREATE TABLE IF NOT EXISTS `moon_goals` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `cycle_id` varchar(32) NOT NULL,
  `position` int NOT NULL,
  `text` varchar(200) NOT NULL,
  `done_when` varchar(300) NULL,
  `season_goal_id` varchar(64) NULL,
  `status` varchar(12) NOT NULL DEFAULT 'open',
  `let_go_reason` varchar(300) NULL,
  `carried_from_id` varchar(64) NULL,
  `carry_count` int NOT NULL DEFAULT 0,
  `set_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `scored_at` timestamp NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `moon_goals_member_cycle_position` (`user_id`, `cycle_id`, `position`),
  KEY `moon_goals_carried_from` (`carried_from_id`)
);

ALTER TABLE `moon_recap_items`
  ADD COLUMN `task_status` varchar(12) NULL,
  ADD COLUMN `redirect_to` varchar(120) NULL,
  ADD COLUMN `let_go_reason` varchar(300) NULL,
  ADD COLUMN `set_on` date NULL,
  ADD COLUMN `belongs_to_role_id` varchar(64) NULL;

ALTER TABLE `moon_recaps`
  ADD COLUMN `task_num_halves` int NULL,
  ADD COLUMN `task_den` int NULL,
  ADD COLUMN `seat_on` int NULL,
  ADD COLUMN `seat_total` int NULL,
  ADD COLUMN `goal_num_halves` int NULL,
  ADD COLUMN `goal_den` int NULL;
